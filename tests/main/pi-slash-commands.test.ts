import { EventEmitter } from 'node:events';
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';
import type {
	ChildLike,
	SpawnFn,
} from '../../src/main/pi-agent/cli-rpc/spawn-env.ts';
import { resolvePiSlashCommands } from '../../src/main/pi-agent/pi-slash-commands.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';

const temporaryDirectories: string[] = [];

interface FakeChild extends ChildLike {
	close: (code?: number | null, signal?: NodeJS.Signals | null) => void;
	emitStderr: (chunk: string | Buffer) => void;
	emitStdout: (chunk: string | Buffer) => void;
	killSignals: () => readonly NodeJS.Signals[];
	stdinChunks: () => readonly string[];
}

interface SpawnRecord {
	args: readonly string[];
	command: string;
	cwd: string;
	detached?: boolean;
	env: NodeJS.ProcessEnv;
}

interface FakeChildOptions {
	onRequest?: (request: Record<string, unknown>, child: FakeChild) => void;
	closeOnKill?: NodeJS.Signals | null;
}

/** Creates a controllable child-process-shaped transport for RPC failure tests. */
function createFakeChild({
	onRequest,
	closeOnKill = 'SIGTERM',
}: FakeChildOptions = {}): FakeChild {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	const emitter = new EventEmitter();
	const signals: NodeJS.Signals[] = [];
	const chunks: string[] = [];
	let child!: FakeChild;

	stdin.on('data', (chunk: Buffer) => {
		const text = chunk.toString('utf8');
		chunks.push(text);
		for (const line of text.trim().split('\n')) {
			if (!line) continue;
			onRequest?.(JSON.parse(line) as Record<string, unknown>, child);
		}
	});

	child = Object.assign(emitter, {
		close: (
			code: number | null = null,
			signal: NodeJS.Signals | null = null,
		) => {
			emitter.emit('close', code, signal);
		},
		emitStderr: (chunk: string | Buffer) => {
			stderr.write(chunk);
		},
		emitStdout: (chunk: string | Buffer) => {
			stdout.write(chunk);
		},
		kill: (signal: NodeJS.Signals = 'SIGTERM') => {
			signals.push(signal);
			if (closeOnKill === signal) {
				queueMicrotask(() => child.close(null, signal));
			}
			return true;
		},
		killSignals: () => signals.slice(),
		pid: undefined,
		stderr,
		stdin,
		stdinChunks: () => chunks.slice(),
		stdout,
	}) as unknown as FakeChild;

	return child;
}

/** Creates a fake spawn function and records every transport invocation. */
function createFakeSpawner(childOptions: FakeChildOptions = {}): {
	children: FakeChild[];
	records: SpawnRecord[];
	spawn: SpawnFn;
} {
	const children: FakeChild[] = [];
	const records: SpawnRecord[] = [];
	const spawn: SpawnFn = (input) => {
		records.push(input);
		const child = createFakeChild(childOptions);
		children.push(child);
		return child;
	};
	return { children, records, spawn };
}

/** Creates a ready Pi executable snapshot for resolver tests. */
function executableSnapshot(command = '/tmp/pi'): PiExecutableSnapshot {
	return {
		command,
		diagnostics: [],
		displayPath: command,
		path: command,
		probe: null,
		setting: null,
		source: 'path',
		status: 'ok',
		updatedAt: new Date(0).toISOString(),
	};
}

/** Returns the standard successful RPC response for a request id. */
function successFrame(
	id: unknown,
	data: unknown = { commands: [] },
): Record<string, unknown> {
	return { command: 'get_commands', data, id, success: true, type: 'response' };
}

/** Serializes one RPC frame to the fake child's stdout. */
function emitFrame(child: FakeChild, frame: unknown): void {
	child.emitStdout(`${JSON.stringify(frame)}\n`);
}

/** Invokes the resolver with the test's common environment defaults. */
function resolve(
	overrides: Parameters<typeof resolvePiSlashCommands>[3] = {},
	cwd = '/tmp/workspace',
	skills: readonly string[] = [],
	executable = executableSnapshot(),
) {
	return resolvePiSlashCommands(executable, cwd, skills, {
		resolveBaseEnv: () => ({ PATH: '/usr/bin', TEST_BASE: 'yes' }),
		...overrides,
	});
}

/** Creates a temporary directory and records it for test cleanup. */
function createTemporaryDirectory(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-pi-slash-'));
	temporaryDirectories.push(directory);
	return directory;
}

/** Returns whether a process still accepts a signal-zero liveness probe. */
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Writes an executable shell wrapper around a node-based fake RPC endpoint. */
function writeStubbornRpcWrapper(directory: string): {
	endpoint: string;
	pidMarker: string;
	wrapper: string;
} {
	const endpoint = path.join(directory, 'stubborn-endpoint.cjs');
	const pidMarker = path.join(directory, 'stubborn-child.pid');
	const wrapper = path.join(directory, 'non-exec-wrapper.sh');
	writeFileSync(
		endpoint,
		`const fs = require('node:fs');
const { spawn } = require('node:child_process');
const worker = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); if (process.send) process.send('ready'); setInterval(() => {}, 1000);"], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
let ready = false;
let requestReceived = false;
const emitUiRequest = () => {
  if (!ready || !requestReceived) return;
  process.stdout.write(JSON.stringify({ type: 'extension_ui_request', method: 'prompt' }) + '\\n');
};
worker.on('message', (message) => {
  if (message !== 'ready') return;
  ready = true;
  fs.writeFileSync(process.env.PI_TEST_PID_MARKER, String(worker.pid));
  emitUiRequest();
});
let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk.toString('utf8');
  if (!input.includes('\\n')) return;
  requestReceived = true;
  emitUiRequest();
});
`,
	);
	writeFileSync(
		wrapper,
		`#!/bin/sh
"$PI_TEST_NODE" "$PI_TEST_ENDPOINT" "$@"
wait
`,
	);
	chmodSync(wrapper, 0o755);
	return { endpoint, pidMarker, wrapper };
}

/** Writes an executable shell wrapper around a node-based fake RPC endpoint. */
function writeRealRpcWrapper(directory: string): {
	endpoint: string;
	marker: string;
	wrapper: string;
} {
	const endpoint = path.join(directory, 'rpc-endpoint.cjs');
	const marker = path.join(directory, 'invocation.json');
	const wrapper = path.join(directory, 'pi-wrapper.sh');
	writeFileSync(
		endpoint,
		`const fs = require('node:fs');
let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk.toString('utf8');
  if (!input.includes('\\n')) return;
  const request = JSON.parse(input.trim());
  fs.writeFileSync(process.env.PI_TEST_MARKER, JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    env: { PI_TEST_NODE: process.env.PI_TEST_NODE, TEST_BASE: process.env.TEST_BASE },
    request,
  }));
  process.stdout.write(JSON.stringify({
    command: 'get_commands',
    data: { commands: [
      { name: 'path-command', source: 'extension', location: 'path' },
      { name: 'project-skill', description: 'Skill from project', source: 'skill', location: 'project' }
    ] },
    id: request.id,
    success: true,
    type: 'response'
  }) + '\\n');
});
`,
	);
	writeFileSync(
		wrapper,
		`#!/bin/sh
exec "$PI_TEST_NODE" "$PI_TEST_ENDPOINT" "$@"
`,
	);
	chmodSync(wrapper, 0o755);
	return { endpoint, marker, wrapper };
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe('Pi slash command discovery', () => {
	it.skipIf(process.platform === 'win32')(
		'uses a real executable wrapper, propagates cwd/env/skills, and maps runtime commands',
		async () => {
			const directory = createTemporaryDirectory();
			const workspace = path.join(directory, 'workspace');
			mkdirSync(workspace);
			const { endpoint, marker, wrapper } = writeRealRpcWrapper(directory);
			const result = await resolvePiSlashCommands(
				executableSnapshot(wrapper),
				workspace,
				['/skills/one', '/skills/two'],
				{
					timeoutMs: 5000,
					killGraceMs: 10,
					resolveBaseEnv: () => ({
						PATH: process.env.PATH,
						PI_TEST_ENDPOINT: endpoint,
						PI_TEST_MARKER: marker,
						PI_TEST_NODE: process.execPath,
						TEST_BASE: 'yes',
					}),
				},
			);

			expect(result).toEqual({
				commands: [
					{
						autoSubmit: false,
						command: 'path-command',
						description: '',
						source: 'extension',
						sourceScope: 'temporary',
					},
					{
						autoSubmit: false,
						command: 'project-skill',
						description: 'Skill from project',
						source: 'skill',
						sourceScope: 'project',
					},
				],
				error: null,
				source: 'runtime',
			});
			const invocation = JSON.parse(readFileSync(marker, 'utf8')) as {
				argv: string[];
				cwd: string;
				env: { PI_TEST_NODE: string; TEST_BASE: string };
				request: { id: string; type: string };
			};
			expect(invocation.argv).toEqual([
				'--mode',
				'rpc',
				'--no-session',
				'--no-tools',
				'--skill',
				'/skills/one',
				'--skill',
				'/skills/two',
			]);
			expect(invocation.cwd).toBe(realpathSync(workspace));
			expect(invocation.env).toEqual({
				PI_TEST_NODE: process.execPath,
				TEST_BASE: 'yes',
			});
			expect(invocation.request.type).toBe('get_commands');
			expect(Object.keys(invocation.request)).toEqual(['id', 'type']);
		},
	);

	it.skipIf(process.platform === 'win32').each(['exec', 'non-exec'])(
		'waits for asynchronous disposal through a %s wrapper',
		async (kind) => {
			const directory = createTemporaryDirectory();
			const { endpoint, marker, wrapper } = writeRealRpcWrapper(directory);
			const disposed = path.join(directory, 'disposed');
			writeFileSync(
				endpoint,
				`${readFileSync(endpoint, 'utf8')}
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) process.exit(0);
  shuttingDown = true;
  process.off('SIGTERM', shutdown);
  await new Promise((done) => setTimeout(done, 100));
  fs.writeFileSync(process.env.PI_TEST_DISPOSED, 'complete');
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.stdin.on('end', shutdown);
`,
			);
			if (kind === 'non-exec') {
				writeFileSync(
					wrapper,
					`${readFileSync(wrapper, 'utf8').replace('exec ', '')}\nwait\n`,
				);
			}
			const result = await resolvePiSlashCommands(
				executableSnapshot(wrapper),
				directory,
				[],
				{
					timeoutMs: 5000,
					killGraceMs: 1000,
					resolveBaseEnv: () => ({
						PATH: process.env.PATH,
						PI_TEST_ENDPOINT: endpoint,
						PI_TEST_MARKER: marker,
						PI_TEST_DISPOSED: disposed,
						PI_TEST_NODE: process.execPath,
					}),
				},
			);
			expect(result.source).toBe('runtime');
			expect(readFileSync(disposed, 'utf8')).toBe('complete');
		},
	);

	it.skipIf(process.platform === 'win32')(
		'kills a stubborn descendant of a non-exec wrapper process group',
		async () => {
			const directory = createTemporaryDirectory();
			const { endpoint, pidMarker, wrapper } =
				writeStubbornRpcWrapper(directory);
			let pid: number | undefined;
			let aliveAfterPolling = true;
			try {
				const result = await resolvePiSlashCommands(
					executableSnapshot(wrapper),
					directory,
					[],
					{
						timeoutMs: 1000,
						killGraceMs: 10,
						resolveBaseEnv: () => ({
							PATH: process.env.PATH,
							PI_TEST_ENDPOINT: endpoint,
							PI_TEST_NODE: process.execPath,
							PI_TEST_PID_MARKER: pidMarker,
						}),
					},
				);
				expect(result.source).toBe('static');
				expect(result.error).toMatch(/user interaction/i);

				pid = Number(readFileSync(pidMarker, 'utf8'));
				for (
					let attempt = 0;
					attempt < 50 && isProcessAlive(pid);
					attempt += 1
				) {
					await new Promise<void>((done) => setTimeout(done, 10));
				}
				aliveAfterPolling = isProcessAlive(pid);
			} finally {
				if (pid !== undefined && isProcessAlive(pid)) {
					process.kill(pid, 'SIGKILL');
				}
			}
			expect(aliveAfterPolling).toBe(false);
		},
	);

	it('returns a valid runtime empty catalogue with a null error', async () => {
		const recorder = createFakeSpawner({
			onRequest: (request, child) => emitFrame(child, successFrame(request.id)),
		});

		expect(await resolve({ spawn: recorder.spawn })).toEqual({
			commands: [],
			error: null,
			source: 'runtime',
		});
	});

	it('correlates only the get_commands response and ignores passive or unrelated frames', async () => {
		const recorder = createFakeSpawner({
			onRequest: (request, child) => {
				emitFrame(child, { type: 'notify', message: 'passive event' });
				emitFrame(child, { type: 'extension_ui_request', method: 'notify' });
				emitFrame(child, { type: 'extension_ui_request', method: 'setStatus' });
				emitFrame(child, { type: 'setWidget', value: 'ignored' });
				emitFrame(child, {
					command: 'other',
					data: { commands: [] },
					id: 'other-id',
					success: true,
					type: 'response',
				});
				emitFrame(
					child,
					successFrame('other-id', {
						commands: [{ name: 'wrong', source: 'skill' }],
					}),
				);
				emitFrame(
					child,
					successFrame(request.id, {
						commands: [{ name: 'right', source: 'prompt' }],
					}),
				);
			},
		});

		const result = await resolve({ spawn: recorder.spawn });
		expect(result.source).toBe('runtime');
		expect(result.error).toBeNull();
		expect(result.commands).toEqual([
			{
				autoSubmit: false,
				command: 'right',
				description: '',
				source: 'prompt',
			},
		]);
		expect(recorder.children[0]?.stdinChunks()).toHaveLength(1);
		expect(recorder.children[0]?.stdinChunks()[0]).not.toMatch(
			/prompt|trust|response/,
		);
	});

	it('uses newer sourceInfo.scope provenance before legacy location', async () => {
		const recorder = createFakeSpawner({
			onRequest: (request, child) =>
				emitFrame(
					child,
					successFrame(request.id, {
						commands: [
							{
								name: 'user-command',
								source: 'extension',
								sourceInfo: { scope: 'user' },
								location: 'project',
							},
							{
								name: 'project-command',
								source: 'prompt',
								sourceInfo: { scope: 'project' },
								location: 'path',
							},
							{
								name: 'temporary-command',
								source: 'skill',
								sourceInfo: { scope: 'temporary' },
								location: 'user',
							},
						],
					}),
				),
		});

		const result = await resolve({ spawn: recorder.spawn });
		expect(result).toEqual({
			commands: [
				{
					autoSubmit: false,
					command: 'user-command',
					description: '',
					source: 'extension',
					sourceScope: 'user',
				},
				{
					autoSubmit: false,
					command: 'project-command',
					description: '',
					source: 'prompt',
					sourceScope: 'project',
				},
				{
					autoSubmit: false,
					command: 'temporary-command',
					description: '',
					source: 'skill',
					sourceScope: 'temporary',
				},
			],
			error: null,
			source: 'runtime',
		});
	});

	it.each([
		['null data', null],
		['missing commands', {}],
		['non-array commands', { commands: 'bad' }],
		['malformed entry', { commands: [{ name: 'bad', source: 'unknown' }] }],
		['empty name', { commands: [{ name: ' ', source: 'skill' }] }],
		[
			'non-string description',
			{ commands: [{ name: 'bad', description: 1, source: 'skill' }] },
		],
		[
			'bad location',
			{ commands: [{ name: 'bad', location: 'global', source: 'skill' }] },
		],
		['bad path', { commands: [{ name: 'bad', path: 1, source: 'skill' }] }],
		[
			'non-record sourceInfo',
			{ commands: [{ name: 'bad', source: 'skill', sourceInfo: 'bad' }] },
		],
		[
			'null sourceInfo scope',
			{
				commands: [
					{ name: 'bad', source: 'skill', sourceInfo: { scope: null } },
				],
			},
		],
		[
			'invalid sourceInfo scope',
			{
				commands: [
					{ name: 'bad', source: 'skill', sourceInfo: { scope: 'path' } },
				],
			},
		],
		[
			'numeric sourceInfo scope',
			{
				commands: [{ name: 'bad', source: 'skill', sourceInfo: { scope: 1 } }],
			},
		],
	] as const)('rejects %s as static/error', async (_label, data) => {
		const recorder = createFakeSpawner({
			onRequest: (request, child) =>
				emitFrame(child, successFrame(request.id, data)),
		});

		const result = await resolve({ spawn: recorder.spawn });
		expect(result.source).toBe('static');
		expect(result.commands).toEqual([]);
		expect(result.error).toEqual(expect.any(String));
	});

	it.each([
		['missing response command', { id: 'id', success: true, type: 'response' }],
		[
			'missing success flag',
			{
				command: 'get_commands',
				data: { commands: [] },
				id: 'id',
				type: 'response',
			},
		],
		[
			'wrong response command',
			{
				command: 'other',
				data: { commands: [] },
				id: 'id',
				success: true,
				type: 'response',
			},
		],
		[
			'failed response without error',
			{ command: 'get_commands', id: 'id', success: false, type: 'response' },
		],
		[
			'failed response with error',
			{
				command: 'get_commands',
				error: 'denied',
				id: 'id',
				success: false,
				type: 'response',
			},
		],
	] as const)('rejects %s envelope', async (_label, frame) => {
		const recorder = createFakeSpawner({
			onRequest: (request, child) =>
				emitFrame(child, { ...frame, id: request.id }),
		});

		const result = await resolve({ spawn: recorder.spawn });
		expect(result.source).toBe('static');
		expect(result.commands).toEqual([]);
		expect(result.error).toEqual(expect.any(String));
	});

	it('fails closed on malformed JSON and oversize stdout', async () => {
		const malformed = createFakeSpawner({
			onRequest: (_request, child) => child.emitStdout('{not-json}\n'),
		});
		const malformedResult = await resolve({ spawn: malformed.spawn });
		expect(malformedResult.source).toBe('static');
		expect(malformedResult.error).toMatch(/invalid json/i);

		const oversize = createFakeSpawner({
			onRequest: (_request, child) =>
				child.emitStdout(`${'x'.repeat(1024 * 1024 + 1)}\n`),
		});
		const oversizeResult = await resolve({ spawn: oversize.spawn });
		expect(oversizeResult.source).toBe('static');
		expect(oversizeResult.error).toMatch(/oversize|exceeded/i);
	});

	it('fails on timeout, spawn failure, pipe failure, and early close', async () => {
		const timeout = createFakeSpawner({ closeOnKill: 'SIGTERM' });
		const timeoutResult = await resolve({
			spawn: timeout.spawn,
			timeoutMs: 10,
			killGraceMs: 5,
		});
		expect(timeoutResult.source).toBe('static');
		expect(timeoutResult.error).toMatch(/timed out/i);
		expect(timeout.children[0]?.killSignals()).toContain('SIGTERM');

		const throwingSpawn: SpawnFn = () => {
			throw new Error('spawn unavailable');
		};
		const spawnResult = await resolve({ spawn: throwingSpawn });
		expect(spawnResult.source).toBe('static');
		expect(spawnResult.error).toMatch(/spawn unavailable/i);

		const pipe = createFakeSpawner();
		const pipePromise = resolve({ spawn: pipe.spawn });
		await new Promise<void>((done) => setImmediate(done));
		pipe.children[0]?.stdin.emit('error', new Error('EPIPE'));
		const pipeResult = await pipePromise;
		expect(pipeResult.source).toBe('static');
		expect(pipeResult.error).toMatch(/pipe failed/i);

		const earlyClose = createFakeSpawner({ closeOnKill: null });
		const earlyPromise = resolve({ spawn: earlyClose.spawn });
		await new Promise<void>((done) => setImmediate(done));
		earlyClose.children[0]?.close(1, null);
		const earlyResult = await earlyPromise;
		expect(earlyResult.source).toBe('static');
		expect(earlyResult.error).toMatch(/exited before/i);
	});

	it.each([
		['prompt', { type: 'extension_ui_request', method: 'prompt' }],
		['confirm', { type: 'extension_ui_request', method: 'confirm' }],
		['extension_error', { type: 'extension_error' }],
		['agent_start', { type: 'agent_start' }],
	])('rejects blocking startup frame: %s', async (_label, frame) => {
		const recorder = createFakeSpawner({
			onRequest: (_request, child) => emitFrame(child, frame),
		});

		const result = await resolve({ spawn: recorder.spawn });
		expect(result.source).toBe('static');
		expect(result.commands).toEqual([]);
		expect(result.error).toEqual(expect.any(String));
	});

	it('deduplicates only matching in-flight inputs and does not cache completed results', async () => {
		const recorder = createFakeSpawner({
			onRequest: (request, child) =>
				setImmediate(() => emitFrame(child, successFrame(request.id))),
		});
		const first = resolve({ spawn: recorder.spawn });
		const second = resolve({ spawn: recorder.spawn });
		await Promise.all([first, second]);
		expect(recorder.records).toHaveLength(1);

		await resolve({ spawn: recorder.spawn });
		expect(recorder.records).toHaveLength(2);

		await resolve({ spawn: recorder.spawn }, '/tmp/other-workspace');
		await resolve({ spawn: recorder.spawn }, '/tmp/workspace', [
			'/skills/other',
		]);
		await resolve({ spawn: recorder.spawn, timeoutMs: 11 });
		await resolve({ spawn: recorder.spawn, killGraceMs: 11 });
		await resolve({
			spawn: recorder.spawn,
			resolveBaseEnv: () => ({ PATH: '/usr/bin', TEST_BASE: 'different' }),
		});
		await resolve(
			{ spawn: recorder.spawn },
			'/tmp/workspace',
			[],
			executableSnapshot('/tmp/other-pi'),
		);
		expect(recorder.records).toHaveLength(8);

		const otherRecorder = createFakeSpawner({
			onRequest: (request, child) => emitFrame(child, successFrame(request.id)),
		});
		await resolve({ spawn: otherRecorder.spawn });
		expect(otherRecorder.records).toHaveLength(1);
	});

	it('passes detached process-group cleanup to the default spawn contract', async () => {
		const recorder = createFakeSpawner({
			onRequest: (request, child) => emitFrame(child, successFrame(request.id)),
		});
		await resolve({ spawn: recorder.spawn });
		expect(recorder.records[0]?.detached).toBe(true);
	});

	it('returns static/error when the executable is not ready without spawning', async () => {
		const recorder = createFakeSpawner();
		const result = await resolve(
			{ spawn: recorder.spawn },
			'/tmp/workspace',
			[],
			{ ...executableSnapshot(), command: '', status: 'error' },
		);
		expect(result.source).toBe('static');
		expect(result.commands).toEqual([]);
		expect(recorder.records).toHaveLength(0);
	});
});
