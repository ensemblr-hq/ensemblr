import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	type CommandLaunch,
	type CommandRunOutcome,
	type CommandStarter,
	type ComputeQueueService,
	createComputeQueueService,
} from '../../src/main/compute-queue/index.ts';
import type { ComputeQueueSettings } from '../../src/shared/config.ts';

interface FakeRun {
	finish: (exitCode?: number | null, signal?: string | null) => void;
	killed: number;
	launch: CommandLaunch;
	terminated: number;
}

let root: string;
let workspaces: Record<string, string>;
let settings: ComputeQueueSettings;
let runs: FakeRun[];
let stopped: string[];
let assemble: (workspaceId: string) => Promise<{
	env: Record<string, string>;
	redactValues: readonly string[];
}>;
let clock: number;
let ids: number;
let queue: ComputeQueueService;

const fakeStarter: CommandStarter = (launch) => {
	let resolveDone: (outcome: CommandRunOutcome) => void = () => {};
	const done = new Promise<CommandRunOutcome>((resolve) => {
		resolveDone = resolve;
	});
	const run: FakeRun = {
		finish: (exitCode = 0, signal = null) => resolveDone({ exitCode, signal }),
		killed: 0,
		launch,
		terminated: 0,
	};
	runs.push(run);
	return {
		done,
		kill: () => {
			run.killed += 1;
			resolveDone({ exitCode: null, signal: 'SIGKILL' });
		},
		logPath: null,
		tail: () => ({ omittedChars: 0, text: `tail of ${launch.command}` }),
		terminate: () => {
			run.terminated += 1;
		},
	};
};

/** Lets queued microtasks and the launch's awaits run. */
async function flush(): Promise<void> {
	for (let index = 0; index < 5; index += 1) {
		await new Promise((resolve) => setImmediate(resolve));
	}
}

/** Builds a queue over the test's mutable settings and fake runner. */
function buildQueue(): ComputeQueueService {
	return createComputeQueueService({
		assembleEnvironment: (workspaceId) => assemble(workspaceId),
		baseEnvironment: () => ({ PATH: '/usr/bin', BASE: 'yes' }),
		createId: () => {
			ids += 1;
			return `job-${ids}`;
		},
		now: () => clock,
		readSettings: () => settings,
		resolveWorkspace: (workspaceId) => {
			const workspacePath = workspaces[workspaceId];
			return workspacePath
				? { name: `name-${workspaceId}`, path: workspacePath }
				: null;
		},
		snapshotFinishedLimit: 2,
		historyLimit: 4,
		startCommand: fakeStarter,
		stopScriptTerminal: (terminalId) => stopped.push(terminalId),
	});
}

/** Enqueues an agent command and returns its job id. */
async function enqueue(
	workspaceId: string,
	command: string,
	extra: { initiator?: 'agent' | 'auto' | 'user'; sessionId?: string } = {},
): Promise<string> {
	const outcome = await queue.enqueueCommand({
		command,
		initiator: extra.initiator ?? 'agent',
		sessionId: extra.sessionId ?? null,
		workspaceId,
	});
	if (!outcome.ok) {
		throw new Error(outcome.message);
	}
	return outcome.job.id;
}

/** Current state of one job. */
function stateOf(jobId: string): string | undefined {
	return queue.getJob(jobId)?.state;
}

/** The fake run started for a command. */
function runFor(command: string): FakeRun {
	const run = runs.find((candidate) => candidate.launch.command === command);
	if (!run) {
		throw new Error(`no run for ${command}`);
	}
	return run;
}

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'compute-queue-'));
	workspaces = {};
	for (const name of ['a', 'b', 'c']) {
		workspaces[name] = path.join(root, name);
		mkdirSync(workspaces[name]);
	}
	settings = {
		concurrency: 1,
		enabled: true,
		exemptPatterns: [],
		extraPatterns: [],
		niceness: 7,
	};
	runs = [];
	stopped = [];
	assemble = async () => ({ env: { SECRET: 'shh' }, redactValues: ['shh'] });
	clock = 1_000;
	ids = 0;
	queue = buildQueue();
});

afterEach(() => {
	rmSync(root, { force: true, recursive: true });
});

describe('scheduling', () => {
	it('caps running jobs at the configured slots and grants FIFO within a workspace', async () => {
		const first = await enqueue('a', 'one');
		const second = await enqueue('a', 'two');
		const third = await enqueue('a', 'three');
		await flush();

		expect(stateOf(first)).toBe('running');
		expect(queue.getJob(second)?.position).toBe(1);
		expect(queue.getJob(third)?.position).toBe(2);
		expect(queue.snapshot()).toMatchObject({
			enabled: true,
			inUse: 1,
			slots: 1,
		});
		expect(runs).toHaveLength(1);

		runFor('one').finish(0);
		await flush();
		expect(stateOf(first)).toBe('succeeded');
		expect(stateOf(second)).toBe('running');
		expect(queue.getJob(third)?.position).toBe(1);
	});

	it('round-robins across workspaces, serving the least recently granted first', async () => {
		await enqueue('a', 'a1');
		const a2 = await enqueue('a', 'a2');
		const a3 = await enqueue('a', 'a3');
		const b1 = await enqueue('b', 'b1');
		const c1 = await enqueue('c', 'c1');
		await flush();

		expect(queue.getJob(b1)?.position).toBe(1);
		expect(queue.getJob(c1)?.position).toBe(2);
		expect(queue.getJob(a2)?.position).toBe(3);
		expect(queue.getJob(a3)?.position).toBe(4);

		const granted: string[] = [];
		for (const command of ['a1', 'b1', 'c1', 'a2']) {
			runFor(command).finish(0);
			await flush();
			granted.push(runs.at(-1)?.launch.command ?? '');
		}
		expect(granted).toEqual(['b1', 'c1', 'a2', 'a3']);
	});

	it('grants a user script at once even above the limit, and agents queue behind it', async () => {
		const agent = await enqueue('a', 'agent');
		const waiting = await enqueue('b', 'waiting');
		const lease = queue.acquireScriptLease({
			command: 'bun dev',
			initiator: 'user',
			label: 'Run',
			workspaceId: 'c',
		});
		await expect(lease.granted).resolves.toBe('granted');
		await flush();
		expect(queue.snapshot().inUse).toBe(2);

		runFor('agent').finish(0);
		await flush();
		expect(stateOf(agent)).toBe('succeeded');
		expect(stateOf(waiting)).toBe('queued');

		lease.release({ exitCode: 0 });
		await flush();
		expect(stateOf(lease.jobId)).toBe('succeeded');
		expect(stateOf(waiting)).toBe('running');
	});

	it('grants everything at once when disabled', async () => {
		settings = { ...settings, enabled: false };
		const jobs = [
			await enqueue('a', 'x'),
			await enqueue('a', 'y'),
			await enqueue('a', 'z'),
		];
		await flush();
		expect(jobs.map(stateOf)).toEqual(['running', 'running', 'running']);
		expect(queue.snapshot().enabled).toBe(false);
	});

	it('reads concurrency live and grants on refresh', async () => {
		const jobs = [
			await enqueue('a', 'x'),
			await enqueue('a', 'y'),
			await enqueue('b', 'z'),
		];
		await flush();
		expect(jobs.map(stateOf)).toEqual(['running', 'queued', 'queued']);

		const listener = vi.fn();
		queue.onChange(listener);
		settings = { ...settings, concurrency: 3 };
		queue.refresh();
		await flush();
		expect(jobs.map(stateOf)).toEqual(['running', 'running', 'running']);
		expect(listener).toHaveBeenCalled();
		expect(listener.mock.calls.at(-1)?.[0].slots).toBe(3);
	});
});

describe('command jobs', () => {
	it('passes the assembled overlay, base env, cwd, and niceness to the runner', async () => {
		mkdirSync(path.join(workspaces.a, 'pkg'));
		const outcome = await queue.enqueueCommand({
			command: 'bun test',
			cwd: 'pkg',
			initiator: 'agent',
			label: '  ',
			workspaceId: 'a',
		});
		await flush();
		expect(outcome.ok && outcome.job.label).toBe('bun test');
		const launch = runFor('bun test').launch;
		expect(launch.overlay).toEqual({ SECRET: 'shh' });
		expect(launch.redactValues).toEqual(['shh']);
		expect(launch.baseEnv.BASE).toBe('yes');
		expect(launch.niceness).toBe(7);
		expect(path.basename(launch.cwd)).toBe('pkg');
	});

	it('refuses an unknown workspace and an escaping cwd', async () => {
		await expect(
			queue.enqueueCommand({
				command: 'x',
				initiator: 'agent',
				workspaceId: 'nope',
			}),
		).resolves.toMatchObject({ code: 'not-found', ok: false });
		await expect(
			queue.enqueueCommand({
				command: 'x',
				cwd: '../b',
				initiator: 'agent',
				workspaceId: 'a',
			}),
		).resolves.toMatchObject({ code: 'invalid-cwd', ok: false });
	});

	it('fails a job whose environment cannot be assembled and frees its slot', async () => {
		assemble = async () => {
			throw new Error('vault locked');
		};
		const failed = await enqueue('a', 'first');
		const next = await enqueue('a', 'second');
		await flush();
		expect(queue.getJob(failed)).toMatchObject({ state: 'failed' });
		expect(queue.getJob(failed)?.outputTail).toContain('vault locked');
		expect(stateOf(next)).toBe('failed');
		expect(runs).toHaveLength(0);
	});

	it('records exit code, timings, and the final tail', async () => {
		const job = await enqueue('a', 'build');
		await flush();
		clock = 4_000;
		runFor('build').finish(2, null);
		await flush();
		expect(queue.getJob(job)).toMatchObject({
			durationMs: 3_000,
			exitCode: 2,
			outputTail: 'tail of build',
			state: 'failed',
			waitedMs: 0,
		});
	});

	it('cancels a queued job without ever starting it', async () => {
		await enqueue('a', 'running');
		const queued = await enqueue('a', 'queued');
		expect(queue.cancel(queued)).toBe(true);
		expect(stateOf(queued)).toBe('cancelled');
		expect(queue.cancel(queued)).toBe(false);
		runFor('running').finish(0);
		await flush();
		expect(runs.map((run) => run.launch.command)).toEqual(['running']);
	});

	it('stops a running job through the runner and ends it cancelled', async () => {
		const job = await enqueue('a', 'long');
		await flush();
		expect(queue.cancel(job)).toBe(true);
		expect(runFor('long').terminated).toBe(1);
		expect(stateOf(job)).toBe('running');
		runFor('long').finish(null, 'SIGTERM');
		await flush();
		expect(queue.getJob(job)).toMatchObject({
			signal: 'SIGTERM',
			state: 'cancelled',
		});
	});

	it('keeps bounded history and lists only recent finished jobs in a snapshot', async () => {
		settings = { ...settings, enabled: false };
		const jobs: string[] = [];
		for (const command of ['h1', 'h2', 'h3', 'h4', 'h5']) {
			jobs.push(await enqueue('a', command));
			await flush();
			runFor(command).finish(0);
			await flush();
		}
		expect(queue.getJob(jobs[0])).toBeNull();
		expect(queue.getJob(jobs[1])?.state).toBe('succeeded');
		expect(queue.snapshot().jobs.map((job) => job.id)).toEqual([
			jobs[3],
			jobs[4],
		]);
		expect(queue.snapshot().jobs[0].workspaceName).toBe('name-a');
	});
});

describe('script leases', () => {
	it('resolves cancelled when cancelled before its grant', async () => {
		await enqueue('a', 'busy');
		const lease = queue.acquireScriptLease({
			command: 'setup',
			initiator: 'auto',
			label: 'Setup',
			workspaceId: 'b',
		});
		expect(queue.getJob(lease.jobId)?.position).toBe(1);
		queue.cancel(lease.jobId);
		await expect(lease.granted).resolves.toBe('cancelled');
	});

	it('stops the attached terminal on cancel and ends cancelled on release', async () => {
		const lease = queue.acquireScriptLease({
			command: 'setup',
			initiator: 'auto',
			label: 'Setup',
			workspaceId: 'a',
		});
		await expect(lease.granted).resolves.toBe('granted');
		lease.attachTerminal('term-1');
		expect(queue.getJob(lease.jobId)?.terminalId).toBe('term-1');
		queue.cancel(lease.jobId);
		expect(stopped).toEqual(['term-1']);
		expect(stateOf(lease.jobId)).toBe('running');
		lease.release({ exitCode: 130 });
		lease.release({ exitCode: 0 });
		expect(queue.getJob(lease.jobId)).toMatchObject({
			exitCode: 130,
			state: 'cancelled',
		});
	});

	it('cancels at once without a terminal and stops one attached later', async () => {
		const lease = queue.acquireScriptLease({
			command: 'setup',
			initiator: 'auto',
			label: 'Setup',
			workspaceId: 'a',
		});
		await lease.granted;
		queue.cancel(lease.jobId);
		expect(stateOf(lease.jobId)).toBe('cancelled');
		lease.attachTerminal('late');
		expect(stopped).toEqual(['late']);
	});

	it('ends failed on a non-zero exit', async () => {
		const lease = queue.acquireScriptLease({
			command: 'setup',
			initiator: 'auto',
			label: 'Setup',
			workspaceId: 'a',
		});
		await lease.granted;
		lease.release({ exitCode: 1, signal: null });
		expect(stateOf(lease.jobId)).toBe('failed');
	});
});

describe('release and shutdown', () => {
	it('releases a session’s and a workspace’s unfinished jobs only', async () => {
		settings = { ...settings, concurrency: 1 };
		const mine = await enqueue('a', 'mine', { sessionId: 's1' });
		const mineQueued = await enqueue('b', 'mine2', { sessionId: 's1' });
		const other = await enqueue('c', 'other', { sessionId: 's2' });
		await flush();
		queue.releaseSession('s1');
		expect(stateOf(mineQueued)).toBe('cancelled');
		expect(runFor('mine').terminated).toBe(1);
		runFor('mine').finish(null, 'SIGTERM');
		await flush();
		expect(stateOf(mine)).toBe('cancelled');
		expect(stateOf(other)).toBe('running');

		queue.releaseWorkspace('c');
		expect(runFor('other').terminated).toBe(1);
	});

	it('terminates running jobs, cancels queued ones, and kills on a second call', async () => {
		const running = await enqueue('a', 'running');
		const queued = await enqueue('b', 'queued');
		await flush();
		let resolved = false;
		const first = queue.shutdown().then(() => {
			resolved = true;
		});
		expect(stateOf(queued)).toBe('cancelled');
		expect(runFor('running').terminated).toBe(1);
		await flush();
		expect(resolved).toBe(false);

		const second = queue.shutdown();
		expect(runFor('running').killed).toBe(1);
		await Promise.all([first, second]);
		expect(stateOf(running)).toBe('cancelled');
		expect(runs).toHaveLength(1);

		const late = await enqueue('a', 'late');
		expect(stateOf(late)).toBe('cancelled');
	});
});

describe('waitFor', () => {
	it('settles once every named job finishes and ignores unknown ids', async () => {
		settings = { ...settings, concurrency: 2 };
		const one = await enqueue('a', 'one');
		const two = await enqueue('b', 'two');
		await flush();
		const wait = queue.waitFor([one, two, 'ghost'], { timeoutMs: 60_000 });
		runFor('one').finish(0);
		await flush();
		runFor('two').finish(1);
		const result = await wait;
		expect(result.timedOut).toBe(false);
		expect(result.pending).toEqual([]);
		expect(result.settled.map((job) => job.state)).toEqual([
			'succeeded',
			'failed',
		]);
	});

	it('reports the unfinished jobs at its timeout', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		try {
			const job = await enqueue('a', 'slow');
			const wait = queue.waitFor([job], { timeoutMs: 1_000 });
			vi.advanceTimersByTime(1_000);
			const result = await wait;
			expect(result.timedOut).toBe(true);
			expect(result.pending.map((pending) => pending.id)).toEqual([job]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('returns the current state when aborted', async () => {
		const job = await enqueue('a', 'slow');
		const controller = new AbortController();
		const wait = queue.waitFor([job], {
			signal: controller.signal,
			timeoutMs: 60_000,
		});
		controller.abort();
		const result = await wait;
		expect(result).toMatchObject({ timedOut: false });
		expect(result.pending).toHaveLength(1);
	});
});
