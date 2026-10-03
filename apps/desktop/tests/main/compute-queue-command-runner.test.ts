import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	type CommandOutput,
	createCommandOutput,
	OUTPUT_TAIL_CHARS,
} from '../../src/main/compute-queue/command-output.ts';
import {
	type ComputeJobResult,
	type ComputeQueueService,
	createComputeQueueService,
} from '../../src/main/compute-queue/index.ts';

const SECRET = 'supersecretvalue123';

let root: string;
let workspacePath: string;
let niceness: number;
let queue: ComputeQueueService;

/**
 * Runs one command through the queue with the real runner and waits for it.
 * @param command - Shell command line.
 * @param cwd - Optional workspace-relative directory.
 * @returns The finished job.
 */
async function run(command: string, cwd?: string): Promise<ComputeJobResult> {
	const outcome = await queue.enqueueCommand({
		command,
		cwd,
		initiator: 'agent',
		workspaceId: 'ws',
	});
	if (!outcome.ok) {
		throw new Error(outcome.message);
	}
	const result = await queue.waitFor([outcome.job.id], { timeoutMs: 20_000 });
	const job = result.settled[0];
	if (!job) {
		throw new Error('job did not finish');
	}
	return job;
}

/**
 * Whether a pid still names a live process.
 * @param pid - Process id.
 * @returns True while the process exists.
 */
function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

beforeEach(() => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'compute-runner-')));
	workspacePath = path.join(root, 'ws');
	mkdirSync(workspacePath);
	niceness = 0;
	queue = createComputeQueueService({
		assembleEnvironment: async () => ({
			env: { MY_TOKEN: SECRET, PLAIN: 'visible' },
			redactValues: [SECRET],
		}),
		baseEnvironment: () => ({ ...process.env, NO_COLOR: undefined }),
		killGraceMs: 500,
		readSettings: () => ({
			concurrency: 4,
			enabled: true,
			exemptPatterns: [],
			extraPatterns: [],
			niceness,
		}),
		resolveWorkspace: (workspaceId) =>
			workspaceId === 'ws' ? { name: 'ws', path: workspacePath } : null,
	});
});

afterEach(async () => {
	await queue.shutdown();
	rmSync(root, { force: true, recursive: true });
});

describe('command runner', () => {
	it('reports the exit code and output', async () => {
		const ok = await run('echo "$PLAIN"');
		expect(ok).toMatchObject({ exitCode: 0, state: 'succeeded' });
		expect(ok.outputTail).toBe('visible\n');

		const failed = await run('echo oops >&2; exit 3');
		expect(failed).toMatchObject({ exitCode: 3, state: 'failed' });
		expect(failed.outputTail).toBe('oops\n');
	});

	it('sets NO_COLOR unless the environment already does', async () => {
		expect((await run('printf %s "$NO_COLOR"')).outputTail).toBe('1');
	});

	it('runs under nice when a niceness is configured', async () => {
		niceness = 5;
		const before = Number.parseInt((await run('nice')).outputTail, 10);
		expect(Number.isNaN(before)).toBe(false);
		expect(before).toBeGreaterThanOrEqual(5);
	});

	it('runs in the requested cwd and refuses one outside the workspace', async () => {
		mkdirSync(path.join(workspacePath, 'pkg'));
		expect((await run('pwd', 'pkg')).outputTail).toBe(
			`${path.join(workspacePath, 'pkg')}\n`,
		);

		symlinkSync(root, path.join(workspacePath, 'escape'));
		for (const cwd of ['../', '..', '/tmp', 'escape', 'missing']) {
			await expect(
				queue.enqueueCommand({
					command: 'pwd',
					cwd,
					initiator: 'agent',
					workspaceId: 'ws',
				}),
			).resolves.toMatchObject({ code: 'invalid-cwd', ok: false });
		}
	});

	it('kills a grandchild through the process group on cancel', async () => {
		const outcome = await queue.enqueueCommand({
			command: 'sleep 30 & echo $! > grandchild.pid; wait',
			initiator: 'agent',
			workspaceId: 'ws',
		});
		if (!outcome.ok) {
			throw new Error(outcome.message);
		}
		const pidFile = path.join(workspacePath, 'grandchild.pid');
		const deadline = Date.now() + 5_000;
		while (
			!existsSync(pidFile) ||
			readFileSync(pidFile, 'utf8').trim() === ''
		) {
			if (Date.now() > deadline) {
				throw new Error('grandchild never started');
			}
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		const grandchild = Number.parseInt(readFileSync(pidFile, 'utf8'), 10);
		expect(isAlive(grandchild)).toBe(true);

		expect(queue.cancel(outcome.job.id)).toBe(true);
		const result = await queue.waitFor([outcome.job.id], { timeoutMs: 10_000 });
		expect(result.settled[0]?.state).toBe('cancelled');
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(isAlive(grandchild)).toBe(false);
	});

	it('keeps only the output tail and counts what it dropped', async () => {
		const lines = 20_000;
		const total = lines * 'line of output\n'.length;
		const job = await run(`yes 'line of output' | head -n ${lines}`);
		expect(job.outputTail).toHaveLength(OUTPUT_TAIL_CHARS);
		expect(job.omittedChars).toBe(total - OUTPUT_TAIL_CHARS);
		expect(job.state).toBe('succeeded');
	});

	it('redacts secrets and strips ANSI in the tail and the log', async () => {
		const job = await run(
			`echo "token=$MY_TOKEN"; printf '\\033[31mred\\033[0m\\n'`,
		);
		expect(job.outputTail).not.toContain(SECRET);
		expect(job.outputTail).toContain('[REDACTED]');
		expect(job.outputTail).toContain('red\n');
		expect(job.outputTail).not.toContain('\u001B');

		expect(job.logPath).toBe(
			path.join(workspacePath, '.context', 'compute-queue', `${job.id}.log`),
		);
		const log = readFileSync(job.logPath ?? '', 'utf8');
		expect(log).toBe(job.outputTail);
		expect(statSync(path.dirname(job.logPath ?? '')).mode & 0o777).toBe(0o700);
		expect(statSync(job.logPath ?? '').mode & 0o777).toBe(0o600);
	});
});

describe('backgrounded children', () => {
	it('kills a child that left the pipes once the job itself exits', async () => {
		const job = await run(
			'sleep 30 >/dev/null 2>&1 & echo $! > background.pid',
		);
		expect(job.state).toBe('succeeded');
		const pid = Number.parseInt(
			readFileSync(path.join(workspacePath, 'background.pid'), 'utf8'),
			10,
		);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(isAlive(pid)).toBe(false);
	});
});

/** A multi-line secret as an environment variable would hold it. */
const MULTI_LINE_SECRET = 'first-line-of-secret\nsecond-line-of-secret';

/** A PEM private key body split over two pipe chunks in the test below. */
const KEY_LINES = [
	'-----BEGIN RSA PRIVATE KEY-----',
	'MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun',
	'VTLw7onLRnrq0/IzW7yWR7QkrmBL7jTKEn5u+qKhbwKfBstIs+bMY2Zkp18gnTxK',
	'-----END RSA PRIVATE KEY-----',
];

/**
 * Builds a collector for a direct output test.
 * @param redactValues - Literal secrets to redact.
 * @returns The collector.
 */
function collector(redactValues: readonly string[]): CommandOutput {
	return createCommandOutput({
		jobId: `direct-${Math.random().toString(36).slice(2)}`,
		redactValues,
		workspacePath,
	});
}

/**
 * Feeds text to a collector's stdout.
 * @param output - The collector.
 * @param text - Text to write as one chunk.
 */
function feed(output: CommandOutput, text: string): void {
	output.write('stdout', Buffer.from(text));
}

describe('chunk-boundary redaction', () => {
	it('redacts a multi-line secret whose lines arrive in different chunks', async () => {
		const output = collector([MULTI_LINE_SECRET]);
		feed(output, 'before first-line-of-secret\n');
		feed(output, 'second-line-of-secret after\n');
		await output.end();
		const { text } = output.tail();
		expect(text).toBe('before [REDACTED]\n[REDACTED] after\n');
		expect(readFileSync(output.logPath ?? '', 'utf8')).toBe(text);
	});

	it('holds a private key split across chunks until its END and redacts it whole', async () => {
		const output = collector([]);
		feed(output, `x\n${KEY_LINES[0]}\n${KEY_LINES[1]}\n`);
		expect(output.tail().text).toBe('x\n[REDACTED]\n');
		feed(output, `${KEY_LINES[2]}\n${KEY_LINES[3]}\ny\n`);
		await output.end();
		expect(output.tail().text).toBe('x\n[REDACTED]\ny\n');
		expect(readFileSync(output.logPath ?? '', 'utf8')).toBe(
			'x\n[REDACTED]\ny\n',
		);
	});

	it('masks a private key the process never closed', async () => {
		const output = collector([]);
		feed(output, `${KEY_LINES[0]}\n${KEY_LINES[1]}\n`);
		await output.end();
		expect(output.tail().text).toBe('[REDACTED]\n');
	});

	it('never cuts a literal secret when a newline-free line outgrows the buffer', async () => {
		const output = collector([SECRET]);
		const line = `${'z'.repeat(997)}${SECRET}`.repeat(60);
		for (let index = 0; index < line.length; index += 4_093) {
			feed(output, line.slice(index, index + 4_093));
		}
		await output.end();
		const { text } = output.tail();
		expect(text).not.toContain(SECRET.slice(0, 8));
		expect(text).not.toContain(SECRET.slice(-8));
		expect(text.match(/\[REDACTED\]/g)).toHaveLength(60);
	});

	it('redacts a 200 KB single-line identifier run well inside a frame budget', async () => {
		const lines = ['abc_def.'.repeat(25_600), `TOKEN=${'a'.repeat(204_800)}`];
		for (const line of lines) {
			const output = collector([SECRET]);
			const started = performance.now();
			for (let index = 0; index < line.length; index += 65_536) {
				feed(output, line.slice(index, index + 65_536));
			}
			feed(output, '\n');
			output.tail();
			await output.end();
			expect(performance.now() - started).toBeLessThan(100);
		}
	});
});
