import { describe, expect, it, vi } from 'vitest';

import {
	type AgentControlPorts,
	createAgentControlService,
	createGuardrails,
	createOriginRegistry,
	type GuardrailConfig,
	type JobQueuePort,
} from '../../src/main/agent-control/index.ts';
import { fitTail } from '../../src/main/agent-control/payload-fit.ts';
import type { ComputeJobResult } from '../../src/main/compute-queue/index.ts';
import {
	MAX_AGENT_PAYLOAD_CHARS,
	type RunQueuedResult,
	type WaitForJobResult,
} from '../../src/shared/agent-control.ts';
import { isComputeJobFinished } from '../../src/shared/compute-queue.ts';
import {
	type ComputeQueueSettings,
	DEFAULT_APP_SETTINGS,
} from '../../src/shared/config.ts';
import type { PermissionMode } from '../../src/shared/permissions.ts';

const HEAVY = 'bun run test';

/** A job the fake queue holds, with the owner the real one filters by. */
interface FakeJob {
	job: ComputeJobResult;
	rootSessionId: string | null;
}

const jobOf = (overrides: Partial<ComputeJobResult>): ComputeJobResult => ({
	command: HEAVY,
	durationMs: null,
	endedAt: null,
	enqueuedAt: 0,
	exitCode: null,
	id: 'job-1',
	initiator: 'agent',
	kind: 'command',
	label: HEAVY,
	logPath: null,
	omittedChars: 0,
	outputTail: '',
	position: 1,
	sessionId: 'caller',
	signal: null,
	startedAt: null,
	state: 'queued',
	terminalId: null,
	waitedMs: null,
	workspaceId: 'ws',
	workspaceName: 'ws',
	...overrides,
});

/**
 * An in-memory queue: an enqueue lands at the back, and a wait either finishes
 * every named job with `finish` or runs out with them still queued.
 */
const makeQueue = (
	options: {
		settings?: Partial<ComputeQueueSettings>;
		finish?: Partial<ComputeJobResult> | null;
		seed?: readonly FakeJob[];
	} = {},
) => {
	const jobs = new Map<string, FakeJob>(
		(options.seed ?? []).map((entry) => [entry.job.id, entry]),
	);
	let minted = jobs.size;
	const settings: ComputeQueueSettings = {
		...DEFAULT_APP_SETTINGS.computeQueue,
		...options.settings,
	};
	const read = (id: string) => jobs.get(id)?.job ?? null;
	const port: JobQueuePort = {
		cancel: vi.fn((jobId: string) => {
			const entry = jobs.get(jobId);
			if (!entry || isComputeJobFinished(entry.job.state)) {
				return false;
			}
			jobs.set(jobId, {
				...entry,
				job: { ...entry.job, position: null, state: 'cancelled' },
			});
			return true;
		}),
		enqueueCommand: vi.fn(async (request) => {
			if (request.cwd === 'missing') {
				return {
					code: 'invalid-cwd' as const,
					message: 'No such directory.',
					ok: false as const,
				};
			}
			minted += 1;
			const job = jobOf({
				command: request.command,
				id: `job-${minted}`,
				label: request.label ?? request.command,
				logPath: `/ws/.context/compute-queue/job-${minted}.log`,
				position: minted,
				sessionId: request.sessionId ?? null,
				workspaceId: request.workspaceId,
			});
			jobs.set(job.id, { job, rootSessionId: request.rootSessionId ?? null });
			return { job, ok: true as const };
		}),
		getJob: vi.fn(read),
		listJobs: vi.fn((filter = {}) =>
			[...jobs.values()]
				.filter(
					(entry) =>
						(filter.rootSessionId === undefined ||
							entry.rootSessionId === filter.rootSessionId) &&
						(filter.sessionId === undefined ||
							entry.job.sessionId === filter.sessionId) &&
						(filter.workspaceId === undefined ||
							entry.job.workspaceId === filter.workspaceId),
				)
				.map((entry) => entry.job),
		),
		readSettings: () => settings,
		releaseSession: vi.fn(),
		waitFor: vi.fn(async (jobIds: readonly string[]) => {
			if (options.finish) {
				for (const id of jobIds) {
					const entry = jobs.get(id);
					if (entry && !isComputeJobFinished(entry.job.state)) {
						jobs.set(id, {
							...entry,
							job: { ...entry.job, position: null, ...options.finish },
						});
					}
				}
			}
			const current = jobIds.flatMap((id) => {
				const job = read(id);
				return job ? [job] : [];
			});
			return {
				pending: current.filter((job) => !isComputeJobFinished(job.state)),
				settled: current.filter((job) => isComputeJobFinished(job.state)),
				timedOut: current.some((job) => !isComputeJobFinished(job.state)),
			};
		}),
	};
	return { jobs, port };
};

/** Stub ports; only the queue, terminals, plan mode, and permissions are live. */
const makePorts = (
	options: {
		jobQueue?: JobQueuePort;
		mode?: PermissionMode;
		planning?: boolean;
		terminalKind?: string;
		startTerminal?: unknown;
	} = {},
): AgentControlPorts => ({
	...(options.jobQueue ? { jobQueue: options.jobQueue } : {}),
	appSettings: {
		get: () => DEFAULT_APP_SETTINGS,
		update: () => DEFAULT_APP_SETTINGS,
	},
	workspaces: {
		listProjects: vi.fn().mockResolvedValue([]),
		listWorkspaces: vi.fn().mockResolvedValue([]),
	},
	tabs: {
		spawnChatTab: vi.fn().mockResolvedValue({ chatTabId: 't' }),
		closeTab: vi.fn().mockResolvedValue(undefined),
		openNonChatTab: vi.fn().mockResolvedValue({ chatTabId: 't' }),
		listTabs: vi.fn().mockResolvedValue([]),
		resolveTabWorkspace: vi.fn().mockResolvedValue('ws'),
		resolveTabAgentSession: vi.fn().mockResolvedValue(null),
	},
	conversations: {
		startConversation: vi.fn(),
		sendFollowUp: vi.fn(),
		setName: vi.fn(),
		waitForIdle: vi.fn(),
		getStatus: vi.fn().mockResolvedValue(null),
		hasFinalMessage: vi.fn().mockResolvedValue(false),
		getLastMessage: vi.fn().mockResolvedValue(null),
		readTranscript: vi.fn(),
		isSpawnedSubAgent: vi.fn().mockResolvedValue(false),
		listModels: vi.fn(),
		resolveConversationWorkspace: vi.fn().mockResolvedValue('ws'),
		listImmediateChildren: vi.fn().mockReturnValue([]),
	},
	terminals: {
		startTerminal: vi.fn().mockResolvedValue(
			options.startTerminal ?? {
				ok: true,
				shell: '/bin/sh',
				terminalId: 't',
			},
		),
		stopTerminal: vi.fn().mockResolvedValue({ ok: true }),
		writeTerminal: vi.fn().mockResolvedValue(undefined),
		readOutput: vi.fn().mockResolvedValue(''),
		listTerminals: vi.fn().mockResolvedValue([
			{
				foregroundCommand: null,
				kind: options.terminalKind ?? 'terminal',
				scriptName: null,
				shell: '/bin/sh',
				status: 'running',
				terminalId: 'term-1',
				workspaceId: 'ws',
			},
		]),
		listRunScripts: vi.fn().mockResolvedValue({ scripts: [] }),
		resolveTerminalWorkspace: vi.fn().mockResolvedValue('ws'),
	},
	harnesses: { launchHarness: vi.fn() },
	focus: {
		focusTab: vi.fn(),
		focusDockTab: vi.fn(),
		focusPanel: vi.fn(),
		focusWorkspace: vi.fn(),
	},
	board: { setWorkspaceStatus: vi.fn(), getWorkspaceStatus: () => 'backlog' },
	diff: { readWorkspaceDiff: vi.fn() },
	review: {
		listComments: vi.fn(),
		addComments: vi.fn(),
		resolveComments: vi.fn(),
	},
	linear: {
		readLinkedIssue: vi.fn().mockReturnValue(null),
		listIssues: vi.fn(),
		getIssue: vi.fn(),
		getMetadata: vi.fn(),
		createComment: vi.fn(),
		createIssue: vi.fn(),
		updateIssue: vi.fn(),
	},
	permissions: { getMode: () => options.mode ?? 'workspace-trusted' },
	commitCredit: { isCoAuthorEnabled: () => false },
	language: { getLanguage: () => 'en' },
	confirm: { confirm: vi.fn().mockResolvedValue(true) },
	ask: { ask: vi.fn(), releaseSession: vi.fn() },
	planMode: {
		activateForSpawn: vi.fn(),
		exit: vi.fn(),
		hasSubmittedPlan: vi.fn().mockReturnValue(false),
		isActive: vi.fn(() => options.planning ?? false),
		releaseSession: vi.fn(),
	},
	afkMode: {
		activateForSpawn: vi.fn(),
		isActive: vi.fn(() => false),
		releaseSession: vi.fn(),
	},
	reviewLaunch: { composeBrief: vi.fn() },
	sessionNaming: {
		readBrief: vi.fn(),
		setBranchName: vi.fn(),
		setSummary: vi.fn(),
	},
	toolTrust: {
		recordInventory: vi.fn(),
		recordRefusal: vi.fn(),
		trustedTools: () => new Set<string>(),
	},
});

/** A Pi caller in workspace `ws`, rooted at itself, holding token `tok-caller`. */
const setup = (
	ports: AgentControlPorts,
	guardrails: Partial<GuardrailConfig> = {},
) => {
	const registry = createOriginRegistry({ generateToken: () => 'tok-caller' });
	registry.register({
		sessionId: 'caller',
		species: 'pi',
		workspaceCwd: '/ws',
		workspaceId: 'ws',
	});
	const service = createAgentControlService({
		guardrails: createGuardrails(guardrails),
		originRegistry: registry,
		ports,
	});
	const invoke = (op: string, rawArgs: unknown) =>
		service.invoke({
			op: op as Parameters<typeof service.invoke>[0]['op'],
			rawArgs,
			token: 'tok-caller',
		});
	return { invoke, service };
};

const dataOf = <T>(result: { ok: boolean; data?: unknown }): T => {
	expect(result.ok).toBe(true);
	return result.data as T;
};

describe('agent-control compute queue: runQueued', () => {
	it('queues the command under the caller and returns the finished job', async () => {
		const queue = makeQueue({
			finish: {
				durationMs: 1_200,
				exitCode: 0,
				outputTail: 'Tests  12 passed',
				state: 'succeeded',
				waitedMs: 300,
			},
		});
		const { invoke } = setup(makePorts({ jobQueue: queue.port }));

		const data = dataOf<RunQueuedResult>(
			await invoke('runQueued', { command: HEAVY, cwd: 'apps/desktop' }),
		);

		expect(queue.port.enqueueCommand).toHaveBeenCalledWith({
			command: HEAVY,
			cwd: 'apps/desktop',
			initiator: 'agent',
			rootSessionId: 'caller',
			sessionId: 'caller',
			workspaceId: 'ws',
		});
		expect(data.timedOut).toBe(false);
		expect(data.job).toMatchObject({
			exitCode: 0,
			jobId: 'job-1',
			logPath: '.context/compute-queue/job-1.log',
			outputTail: 'Tests  12 passed',
			state: 'succeeded',
		});
		expect(data.note).toBeUndefined();
	});

	it('clamps the wait and calls a timeout a lap, naming the queue position', async () => {
		const queue = makeQueue();
		const { invoke } = setup(makePorts({ jobQueue: queue.port }), {
			waitTimeoutMs: 1_000,
		});

		const data = dataOf<RunQueuedResult>(
			await invoke('runQueued', { command: HEAVY, timeoutMs: 999_999 }),
		);

		expect(queue.port.waitFor).toHaveBeenCalledWith(['job-1'], {
			signal: undefined,
			timeoutMs: 1_000,
		});
		expect(data.timedOut).toBe(true);
		expect(data.note).toContain('Not a failure');
		expect(data.note).toContain('job-1 is queued at position 1');
		expect(data.note).toContain('ensemblr_wait_for_job');
	});

	it('returns at once without waiting when wait is false', async () => {
		const queue = makeQueue();
		const { invoke } = setup(makePorts({ jobQueue: queue.port }));

		const data = dataOf<RunQueuedResult>(
			await invoke('runQueued', { command: HEAVY, wait: false }),
		);

		expect(queue.port.waitFor).not.toHaveBeenCalled();
		expect(data.timedOut).toBe(false);
		expect(data.note).not.toContain('Not a failure');
		expect(data.note).toContain('ensemblr_wait_for_job');
	});

	it('refuses a cwd outside the workspace before the queue sees it', async () => {
		const queue = makeQueue();
		const { invoke } = setup(makePorts({ jobQueue: queue.port }));

		const result = await invoke('runQueued', { command: HEAVY, cwd: '../x' });

		expect(result).toMatchObject({ code: 'invalid-args', ok: false });
		expect(queue.port.enqueueCommand).not.toHaveBeenCalled();
	});

	it('maps a queue invalid-cwd refusal onto invalid-args and refunds the place', async () => {
		const queue = makeQueue();
		const { invoke } = setup(makePorts({ jobQueue: queue.port }), {
			maxUnfinishedJobs: 1,
		});

		const refused = await invoke('runQueued', {
			command: HEAVY,
			cwd: 'missing',
		});
		const accepted = await invoke('runQueued', { command: HEAVY, wait: false });

		expect(refused).toMatchObject({ code: 'invalid-args', ok: false });
		expect(accepted.ok).toBe(true);
	});

	it('caps unfinished jobs per delegation tree, naming what frees a place', async () => {
		const queue = makeQueue();
		const { invoke } = setup(makePorts({ jobQueue: queue.port }), {
			maxUnfinishedJobs: 1,
		});

		await invoke('runQueued', { command: HEAVY, wait: false });
		const second = await invoke('runQueued', { command: HEAVY, wait: false });

		expect(second).toMatchObject({ code: 'denied-quota', ok: false });
		expect((second as { error: string }).error).toContain(
			'ensemblr_cancel_job',
		);
	});

	it('rate-limits enqueues even once the earlier jobs have finished', async () => {
		const queue = makeQueue({ finish: { exitCode: 0, state: 'succeeded' } });
		const { invoke } = setup(makePorts({ jobQueue: queue.port }), {
			maxJobEnqueuesPerMinute: 1,
		});

		await invoke('runQueued', { command: HEAVY });
		const second = await invoke('runQueued', { command: HEAVY });

		expect(second).toMatchObject({ code: 'denied-rate', ok: false });
	});

	it('is a write, so a read-only workspace refuses it', async () => {
		const queue = makeQueue();
		const { invoke } = setup(
			makePorts({ jobQueue: queue.port, mode: 'read-only' }),
		);

		const result = await invoke('runQueued', { command: HEAVY });

		expect(result).toMatchObject({ code: 'denied-permission', ok: false });
		expect(queue.port.enqueueCommand).not.toHaveBeenCalled();
	});

	it('is refused while planning', async () => {
		const queue = makeQueue();
		const { invoke } = setup(
			makePorts({ jobQueue: queue.port, planning: true }),
		);

		const result = await invoke('runQueued', { command: HEAVY });

		expect(result.ok).toBe(false);
		expect(queue.port.enqueueCommand).not.toHaveBeenCalled();
	});

	it('fits a huge output tail to the payload ceiling, keeping its end', async () => {
		const output = `${'x'.repeat(100_000)}FINAL VERDICT`;
		const queue = makeQueue({
			finish: { exitCode: 1, outputTail: output, state: 'failed' },
		});
		const { invoke } = setup(makePorts({ jobQueue: queue.port }));

		const data = dataOf<RunQueuedResult>(
			await invoke('runQueued', { command: HEAVY }),
		);

		expect(JSON.stringify(data).length).toBeLessThanOrEqual(
			MAX_AGENT_PAYLOAD_CHARS,
		);
		expect(data.job.outputTail.endsWith('FINAL VERDICT')).toBe(true);
		expect(data.job.omittedChars).toBe(
			output.length - data.job.outputTail.length,
		);
		expect(data.note).toContain('.context/compute-queue/job-1.log');
	});

	it('is refused outright when no queue is wired', async () => {
		const { invoke } = setup(makePorts());

		const result = await invoke('runQueued', { command: HEAVY });

		expect(result).toMatchObject({ code: 'internal', ok: false });
	});
});

describe('agent-control compute queue: waitForJob and cancelJob', () => {
	const foreign = {
		job: jobOf({ id: 'other', sessionId: 'someone', workspaceId: 'ws-2' }),
		rootSessionId: 'someone',
	};

	it("defaults to the session's unfinished jobs", async () => {
		const queue = makeQueue({
			finish: { exitCode: 0, state: 'succeeded' },
			seed: [
				{ job: jobOf({ id: 'mine' }), rootSessionId: 'caller' },
				{
					job: jobOf({ exitCode: 0, id: 'done', state: 'succeeded' }),
					rootSessionId: 'caller',
				},
				foreign,
			],
		});
		const { invoke } = setup(makePorts({ jobQueue: queue.port }));

		const data = dataOf<WaitForJobResult>(await invoke('waitForJob', {}));

		expect(queue.port.waitFor).toHaveBeenCalledWith(['mine'], {
			signal: undefined,
			timeoutMs: 300_000,
		});
		expect(data.settled.map((job) => job.jobId)).toEqual(['mine']);
		expect(data.pending).toEqual([]);
	});

	it('says so when the session has nothing to wait on', async () => {
		const queue = makeQueue();
		const { invoke } = setup(makePorts({ jobQueue: queue.port }));

		const data = dataOf<WaitForJobResult>(await invoke('waitForJob', {}));

		expect(data.settled).toEqual([]);
		expect(data.note).toContain('nothing to wait on');
		expect(queue.port.waitFor).not.toHaveBeenCalled();
	});

	it('reports a timed-out wait as a lap with every pending id', async () => {
		const queue = makeQueue({
			seed: [{ job: jobOf({ id: 'mine' }), rootSessionId: 'caller' }],
		});
		const { invoke } = setup(makePorts({ jobQueue: queue.port }));

		const data = dataOf<WaitForJobResult>(
			await invoke('waitForJob', { jobIds: ['mine'] }),
		);

		expect(data.timedOut).toBe(true);
		expect(data.pending.map((job) => job.jobId)).toEqual(['mine']);
		expect(data.note).toContain('ensemblr_wait_for_job({ jobIds: ["mine"] })');
	});

	it('refuses a job from another workspace as not-found', async () => {
		const queue = makeQueue({ seed: [foreign] });
		const { invoke } = setup(makePorts({ jobQueue: queue.port }));

		const waited = await invoke('waitForJob', { jobIds: ['other'] });
		const cancelled = await invoke('cancelJob', { jobId: 'other' });

		expect(waited).toMatchObject({ code: 'not-found', ok: false });
		expect(cancelled).toMatchObject({ code: 'not-found', ok: false });
		expect(queue.port.cancel).not.toHaveBeenCalled();
	});

	it('cancels a job in the workspace and reports it as it now stands', async () => {
		const queue = makeQueue({
			seed: [{ job: jobOf({ id: 'mine' }), rootSessionId: 'caller' }],
		});
		const { invoke } = setup(makePorts({ jobQueue: queue.port }));

		const data = dataOf<{ cancelled: boolean; job: { state: string } }>(
			await invoke('cancelJob', { jobId: 'mine' }),
		);

		expect(data).toMatchObject({
			cancelled: true,
			job: { state: 'cancelled' },
		});
	});

	it('cancels a job another agent in its own delegation tree queued', async () => {
		const queue = makeQueue({
			seed: [
				{
					job: jobOf({ id: 'sibling', sessionId: 'leaf' }),
					rootSessionId: 'caller',
				},
			],
		});
		const { invoke } = setup(makePorts({ jobQueue: queue.port }));

		const result = await invoke('cancelJob', { jobId: 'sibling' });

		expect(result.ok).toBe(true);
		expect(queue.port.cancel).toHaveBeenCalledWith('sibling');
	});

	it.each([
		[
			'the user started',
			jobOf({ id: 'x', initiator: 'user', kind: 'script', sessionId: null }),
			null,
		],
		[
			'the app started',
			jobOf({ id: 'x', initiator: 'auto', kind: 'script', sessionId: null }),
			null,
		],
		['another tree queued', jobOf({ id: 'x', sessionId: 'stranger' }), 'other'],
	])('refuses to cancel a job %s in its workspace', async (_who, job, root) => {
		const queue = makeQueue({ seed: [{ job, rootSessionId: root }] });
		const { invoke } = setup(makePorts({ jobQueue: queue.port }));

		const result = await invoke('cancelJob', { jobId: 'x' });

		expect(result).toMatchObject({ code: 'denied-scope', ok: false });
		expect(queue.port.cancel).not.toHaveBeenCalled();
	});

	it('words a wait the turn interrupted as an interruption, not an expiry', async () => {
		const queue = makeQueue({
			seed: [{ job: jobOf({ id: 'mine' }), rootSessionId: 'caller' }],
		});
		const { service } = setup(makePorts({ jobQueue: queue.port }));
		const aborted = new AbortController();
		aborted.abort();

		const waited = dataOf<WaitForJobResult>(
			await service.invoke({
				op: 'waitForJob',
				rawArgs: { jobIds: ['mine'] },
				signal: aborted.signal,
				token: 'tok-caller',
			}),
		);
		const ran = dataOf<RunQueuedResult>(
			await service.invoke({
				op: 'runQueued',
				rawArgs: { command: HEAVY },
				signal: aborted.signal,
				token: 'tok-caller',
			}),
		);

		for (const note of [waited.note, ran.note]) {
			expect(note).toContain('this turn was interrupted');
			expect(note).not.toContain('wait window expired');
		}
	});

	it('cancels the jobs a session owns when the session is released', () => {
		const queue = makeQueue();
		const { service } = setup(makePorts({ jobQueue: queue.port }));

		service.releaseSession('caller');

		expect(queue.port.releaseSession).toHaveBeenCalledWith('caller');
	});
});

describe('agent-control compute queue: Pi bash gate', () => {
	const check = (command: string, ports: AgentControlPorts) =>
		setup(ports).invoke('checkPlanModeTool', { command, tool: 'bash' });

	it('refuses a heavy command and points at the queue tools', async () => {
		const queue = makeQueue();
		const ports = makePorts({ jobQueue: queue.port });

		const verdict = dataOf<{ blocked: boolean; reason?: string }>(
			await check(HEAVY, ports),
		);

		expect(verdict.blocked).toBe(true);
		expect(verdict.reason).toContain('ensemblr_run_queued');
		expect(verdict.reason).toContain('ensemblr_wait_for_job');
		expect(ports.toolTrust?.recordRefusal).not.toHaveBeenCalled();
	});

	it('passes a light command, and a heavy one once the queue is off', async () => {
		const on = makePorts({ jobQueue: makeQueue().port });
		const off = makePorts({
			jobQueue: makeQueue({ settings: { enabled: false } }).port,
		});

		expect(dataOf(await check('git status', on))).toEqual({ blocked: false });
		expect(dataOf(await check(HEAVY, off))).toEqual({ blocked: false });
	});

	it('passes the call, and logs, when the classifier itself throws', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const queue = makeQueue();
		const exploding = {
			...DEFAULT_APP_SETTINGS.computeQueue,
			get exemptPatterns(): string[] {
				throw new Error('boom');
			},
		};
		queue.port.readSettings = () => exploding;
		try {
			expect(
				dataOf(await check(HEAVY, makePorts({ jobQueue: queue.port }))),
			).toEqual({ blocked: false });
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('compute-queue classification failed'),
				expect.objectContaining({ commandLength: HEAVY.length }),
			);
		} finally {
			warn.mockRestore();
		}
	});

	it('leaves the Plan Mode verdict standing, and still records it', async () => {
		const ports = makePorts({ jobQueue: makeQueue().port, planning: true });

		const verdict = dataOf<{ blocked: boolean; reason?: string }>(
			await check(HEAVY, ports),
		);

		expect(verdict.blocked).toBe(true);
		expect(verdict.reason).not.toContain('ensemblr_run_queued');
		expect(ports.toolTrust?.recordRefusal).toHaveBeenCalledWith('pi', 'bash');
	});

	it('never answers a Concierge with the queue', async () => {
		const ports: AgentControlPorts = {
			...makePorts({ jobQueue: makeQueue().port }),
			concierge: {
				deliverMessage: vi.fn(),
				describeContextUsage: () => null,
				describeSession: () => ({ model: null, thinkingLevel: null }),
				homePath: () => '/concierge',
			},
		};
		const registry = createOriginRegistry({ generateToken: () => 'tok-c' });
		registry.register({
			concierge: true,
			sessionId: 'concierge',
			species: 'pi',
			workspaceCwd: '/concierge',
			workspaceId: '',
		});
		const service = createAgentControlService({
			guardrails: createGuardrails(),
			originRegistry: registry,
			ports,
		});

		const result = await service.invoke({
			op: 'checkPlanModeTool',
			rawArgs: { command: HEAVY, tool: 'bash' },
			token: 'tok-c',
		});

		const verdict = dataOf<{ reason?: string }>(result);
		expect(verdict.reason ?? '').not.toContain('ensemblr_run_queued');
	});
});

describe('agent-control compute queue: terminal gate', () => {
	const write = (ports: AgentControlPorts) => {
		const { invoke } = setup(ports);
		return (input: string) =>
			invoke('writeTerminal', { input, terminalId: 'term-1' });
	};

	it('refuses a heavy command typed into a shell terminal', async () => {
		const ports = makePorts({ jobQueue: makeQueue().port });

		const result = await write(ports)(`${HEAVY}\r`);

		expect(result).toMatchObject({ code: 'denied-scope', ok: false });
		expect((result as { error: string }).error).toContain(
			'ensemblr_run_queued',
		);
		expect(ports.terminals.writeTerminal).not.toHaveBeenCalled();
	});

	it('classifies a command split across two writes as a whole', async () => {
		const ports = makePorts({ jobQueue: makeQueue().port });
		const send = write(ports);

		const first = await send('bun ru');
		const second = await send('n test\n');

		expect(first.ok).toBe(true);
		expect(second).toMatchObject({ code: 'denied-scope', ok: false });
		expect(ports.terminals.writeTerminal).toHaveBeenCalledTimes(1);
	});

	it('forgets a line the agent killed before submitting it', async () => {
		const ports = makePorts({ jobQueue: makeQueue().port });
		const send = write(ports);

		await send('bun run t');
		const result = await send('\x15git status\r');

		expect(result.ok).toBe(true);
	});

	it('joins a line continued with a backslash across writes before classifying', async () => {
		const ports = makePorts({ jobQueue: makeQueue().port });
		const send = write(ports);

		const first = await send('bun run \\\r');
		const second = await send('test\r');

		expect(first.ok).toBe(true);
		expect(second).toMatchObject({ code: 'denied-scope', ok: false });
	});

	it('submits a line ending in an escaped backslash rather than continuing it', async () => {
		const ports = makePorts({ jobQueue: makeQueue().port });
		const send = write(ports);

		await send('echo \\\\\r');
		const result = await send('test\r');

		expect(result.ok).toBe(true);
	});

	it('honours backspace when reading the submitted line', async () => {
		const ports = makePorts({ jobQueue: makeQueue().port });

		const result = await write(ports)('bun run testx\x7f\x7f\x7f\x7f\x7f\r');

		expect(result.ok).toBe(true);
	});

	it('leaves a harness terminal alone', async () => {
		const ports = makePorts({
			jobQueue: makeQueue().port,
			terminalKind: 'agent',
		});

		const result = await write(ports)(`${HEAVY}\r`);

		expect(result.ok).toBe(true);
		expect(ports.terminals.writeTerminal).toHaveBeenCalled();
	});
});

describe('agent-control compute queue: queued script start', () => {
	it('reports a heavy script waiting for a slot rather than a terminal', async () => {
		const ports = makePorts({
			startTerminal: { ok: true, queued: { jobId: 'job-9', position: 2 } },
		});
		const { invoke } = setup(ports);

		const data = dataOf<{ note: string; queued: unknown }>(
			await invoke('startTerminal', { kind: 'setup' }),
		);

		expect(ports.terminals.startTerminal).toHaveBeenCalledWith(
			expect.objectContaining({ rootSessionId: 'caller', sessionId: 'caller' }),
		);
		expect(data.queued).toEqual({ jobId: 'job-9', position: 2 });
		expect(data.note).toContain('position 2');
		expect(data.note).toContain('ensemblr_wait_for_job');
		expect(ports.focus.focusDockTab).not.toHaveBeenCalled();
	});

	it("counts the tree's queued scripts against its unfinished-job cap", async () => {
		const queue = makeQueue({
			seed: [
				{
					job: jobOf({ id: 'setup', initiator: 'agent', kind: 'script' }),
					rootSessionId: 'caller',
				},
			],
		});
		const { invoke } = setup(makePorts({ jobQueue: queue.port }), {
			maxUnfinishedJobs: 1,
		});

		const result = await invoke('runQueued', { command: HEAVY, wait: false });

		expect(result).toMatchObject({ code: 'denied-quota', ok: false });
	});
});

describe('agent-control guardrails: compute-queue enqueues', () => {
	it('lets a depth-2 leaf enqueue, which it may not spawn', () => {
		const guardrails = createGuardrails();
		const leaf = {
			concierge: false,
			delegation: 'ensemblr' as const,
			depth: 2 as const,
			parentSessionId: 'manager',
			retired: false,
			rootSessionId: 'root',
			sessionId: 'leaf',
			species: 'pi' as const,
			token: 't',
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		};

		expect(guardrails.reserveSpawn(leaf).ok).toBe(false);
		expect(guardrails.reserveJobEnqueue(leaf, 0).ok).toBe(true);
	});

	it('counts an enqueue still in flight against the cap', () => {
		const guardrails = createGuardrails({ maxUnfinishedJobs: 1 });
		const origin = {
			concierge: false,
			delegation: 'ensemblr' as const,
			depth: 0 as const,
			parentSessionId: null,
			retired: false,
			rootSessionId: 'root',
			sessionId: 'root',
			species: 'pi' as const,
			token: 't',
			workspaceCwd: '/ws',
			workspaceId: 'ws',
		};

		const held = guardrails.reserveJobEnqueue(origin, 0);
		expect(held.ok).toBe(true);
		expect(guardrails.reserveJobEnqueue(origin, 0)).toMatchObject({
			code: 'denied-quota',
			ok: false,
		});
		if (held.ok) {
			held.refund();
		}
		expect(guardrails.reserveJobEnqueue(origin, 0).ok).toBe(true);
	});
});

describe('payload fit: fitTail', () => {
	it('keeps a text that fits whole', () => {
		expect(fitTail('done', 10)).toEqual({ kept: 'done', omitted: 0 });
	});

	it('keeps the longest tail whose escaped form fits, never half a pair', () => {
		const text = `${'a'.repeat(10)}😀\n${'b'.repeat(4)}`;
		const { kept, omitted } = fitTail(text, 8);

		expect(JSON.stringify(kept).length - 2).toBeLessThanOrEqual(8);
		expect(text.endsWith(kept)).toBe(true);
		expect(omitted).toBe(text.length - kept.length);
		expect(kept.charCodeAt(0)).not.toBe(0xde00);
	});
});
