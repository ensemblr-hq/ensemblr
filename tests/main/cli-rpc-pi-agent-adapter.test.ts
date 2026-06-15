import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
	type ChildLike,
	createCliRpcPiAgentAdapter,
	normalizePiPayload,
	type SpawnFn,
} from '../../src/main/pi-agent/cli-rpc-pi-agent-adapter.ts';
import type {
	PiAgentEvent,
	PiAgentSessionMetadata,
} from '../../src/main/pi-agent/pi-agent-types.ts';

interface FakeChildHandle extends ChildLike {
	emitExit: (code: number | null, signal?: NodeJS.Signals | null) => void;
	emitStderr: (chunk: Buffer | string) => void;
	emitStdout: (chunk: Buffer | string) => void;
	getKillSignals: () => readonly NodeJS.Signals[];
	getStdinChunks: () => readonly string[];
}

interface SpawnRecord {
	args: readonly string[];
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

function createFakeChild(): FakeChildHandle {
	const stdout = new EventEmitter() as NodeJS.ReadableStream;
	const stderr = new EventEmitter() as NodeJS.ReadableStream;
	const stdinChunks: string[] = [];
	const killSignals: NodeJS.Signals[] = [];
	const stdin = {
		end: () => undefined,
		once: (_event: string, _handler: () => void) => undefined,
		write: (
			chunk: string | Buffer,
			_enc?: BufferEncoding | (() => void),
			cb?: () => void,
		) => {
			stdinChunks.push(
				typeof chunk === 'string' ? chunk : chunk.toString('utf8'),
			);
			if (typeof cb === 'function') {
				cb();
			}
			return true;
		},
	} as unknown as NodeJS.WritableStream;
	const emitter = new EventEmitter();
	const child = Object.assign(emitter, {
		emitExit: (code: number | null, signal: NodeJS.Signals | null = null) => {
			emitter.emit('exit', code, signal);
		},
		emitStderr: (chunk: Buffer | string) => {
			stderr.emit(
				'data',
				typeof chunk === 'string' ? Buffer.from(chunk) : chunk,
			);
		},
		emitStdout: (chunk: Buffer | string) => {
			stdout.emit(
				'data',
				typeof chunk === 'string' ? Buffer.from(chunk) : chunk,
			);
		},
		exitCode: null as number | null,
		getKillSignals: () => killSignals.slice(),
		getStdinChunks: () => stdinChunks.slice(),
		kill: (signal: NodeJS.Signals = 'SIGTERM') => {
			killSignals.push(signal);
			return true;
		},
		pid: 4242,
		stderr,
		stdin,
		stdout,
	}) as unknown as FakeChildHandle;
	return child;
}

function createSpawnRecorder(): {
	spawn: SpawnFn;
	getChildren: () => readonly FakeChildHandle[];
	getRecords: () => readonly SpawnRecord[];
} {
	const records: SpawnRecord[] = [];
	const children: FakeChildHandle[] = [];
	const spawn: SpawnFn = (input) => {
		records.push(input);
		const child = createFakeChild();
		children.push(child);
		return child;
	};
	return {
		getChildren: () => children.slice(),
		getRecords: () => records.slice(),
		spawn,
	};
}

function buildMetadata(
	overrides: Partial<PiAgentSessionMetadata> = {},
): PiAgentSessionMetadata {
	const base: PiAgentSessionMetadata = {
		args: ['--mode', 'rpc'] as const,
		command: '/usr/local/bin/pi',
		cwd: '/tmp/ensemble/ws',
		env: { LANG: 'en_US.UTF-8' },
		id: 'session-1',
		label: 'test session',
		model: null,
		piAgentDirectoryPreserved: true,
		sessionId: null,
		startedAt: '2026-06-08T00:00:00.000Z',
		status: 'starting',
		thinking: null,
		updatedAt: '2026-06-08T00:00:00.000Z',
	};
	return { ...base, ...overrides };
}

function collectEvents(): {
	events: PiAgentEvent[];
	listener: (event: PiAgentEvent) => void;
} {
	const events: PiAgentEvent[] = [];
	return { events, listener: (event) => events.push(event) };
}

async function waitForMicrotasks(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
}

function firstItem<T>(items: readonly T[]): T {
	const item = items[0];
	assert.ok(item);
	return item;
}

test('spawns the executable with metadata cwd, args, and merged env', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createCliRpcPiAgentAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession({ metadata: buildMetadata() });

	assert.equal(session.id, 'session-1');
	const records = recorder.getRecords();
	assert.equal(records.length, 1);
	const record = firstItem(records);
	assert.equal(record.command, '/usr/local/bin/pi');
	assert.deepEqual(record.args, ['--mode', 'rpc']);
	assert.equal(record.cwd, '/tmp/ensemble/ws');
	assert.equal(record.env.LANG, 'en_US.UTF-8');
	await adapter.shutdown();
});

test('parses JSONL frames into typed events', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createCliRpcPiAgentAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession({ metadata: buildMetadata() });
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	child.emitStdout('{"type":"session","sessionId":"pi-runtime-9"}\n');
	child.emitStdout(
		'{"type":"message","role":"agent","payload":{"text":"hi"}}\n',
	);

	const messageEvent = events.find((event) => event.type === 'message');
	const metadataEvents = events.filter((event) => event.type === 'metadata');
	assert.ok(messageEvent);
	assert.equal(
		(messageEvent as Extract<PiAgentEvent, { type: 'message' }>).role,
		'agent',
	);
	assert.ok(metadataEvents.length >= 1);
	const last = metadataEvents.at(-1);
	assert.equal(
		(last as Extract<PiAgentEvent, { type: 'metadata' }>).metadata.sessionId,
		'pi-runtime-9',
	);
	await adapter.shutdown();
});

test('invalid JSON lines surface as recoverable error events', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createCliRpcPiAgentAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession({ metadata: buildMetadata() });
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	child.emitStdout('not-json-{{{\n');

	const errorEvent = events.find(
		(event): event is Extract<PiAgentEvent, { type: 'error' }> =>
			event.type === 'error',
	);
	assert.ok(errorEvent);
	assert.equal(errorEvent.error.recoverable, true);
	assert.match(errorEvent.error.message, /Invalid JSON/);
	await adapter.shutdown();
});

test('stderr chunks emit recoverable error events tagged "Pi RPC stderr"', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createCliRpcPiAgentAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession({ metadata: buildMetadata() });
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	child.emitStderr('warning: deprecated flag\n');

	const stderrEvent = events.find(
		(event): event is Extract<PiAgentEvent, { type: 'error' }> =>
			event.type === 'error' && event.error.message === 'Pi RPC stderr',
	);
	assert.ok(stderrEvent);
	assert.equal(stderrEvent.error.recoverable, true);
	assert.equal(stderrEvent.error.detail, 'warning: deprecated flag\n');
	await adapter.shutdown();
});

test('crash with non-zero exit emits error then shutdown(crashed)', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createCliRpcPiAgentAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession({ metadata: buildMetadata() });
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	child.emitExit(137, 'SIGKILL');

	const shutdown = events.find((event) => event.type === 'shutdown');
	const errorEvents = events.filter((event) => event.type === 'error');
	assert.ok(shutdown);
	assert.equal(
		(shutdown as Extract<PiAgentEvent, { type: 'shutdown' }>).reason,
		'crashed',
	);
	assert.ok(
		errorEvents.some((event) =>
			/exited with code 137/.test(event.error.message),
		),
	);
});

test('abort signals SIGINT then SIGKILL after the grace window', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createCliRpcPiAgentAdapter({
		killGraceMs: 5,
		spawn: recorder.spawn,
	});
	const session = await adapter.createSession({ metadata: buildMetadata() });
	await session.abort('user clicked stop');
	const child = firstItem(recorder.getChildren());

	await new Promise((resolve) => setTimeout(resolve, 25));
	const signals = child.getKillSignals();
	assert.ok(signals.includes('SIGINT'));
	assert.ok(signals.includes('SIGKILL'));

	// Emit exit so listeners clean up and the test exits cleanly.
	child.emitExit(null, 'SIGKILL');
});

test('submit writes a JSONL frame to stdin and waits for Pi user echo', async () => {
	let turnCounter = 0;
	const recorder = createSpawnRecorder();
	const adapter = createCliRpcPiAgentAdapter({
		spawn: recorder.spawn,
		turnIdFactory: () => `turn-${++turnCounter}`,
	});
	const session = await adapter.createSession({ metadata: buildMetadata() });
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	const ack = await session.submit({ prompt: 'do the thing' });
	assert.equal(ack.turnId, 'turn-1');

	const stdinChunks = child.getStdinChunks();
	assert.equal(stdinChunks.length, 1);
	const firstStdinChunk = stdinChunks[0];
	assert.ok(firstStdinChunk);
	// Pi RPC protocol (@earendil-works/pi-coding-agent): `prompt` command
	// with `message` field, one JSONL frame per line.
	assert.match(firstStdinChunk, /"type":"prompt"/);
	assert.match(firstStdinChunk, /"message":"do the thing"/);
	assert.match(firstStdinChunk, /\n$/);

	const syntheticUserMessage = events.find(
		(event): event is Extract<PiAgentEvent, { type: 'message' }> =>
			event.type === 'message' && event.role === 'user',
	);
	assert.equal(syntheticUserMessage, undefined);

	child.emitStdout(
		'{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"do the thing"}]}}\n',
	);
	const userMessage = events.find(
		(event): event is Extract<PiAgentEvent, { type: 'message' }> =>
			event.type === 'message' && event.role === 'user',
	);
	assert.ok(userMessage);
	assert.equal(userMessage.turnId, 'pending');
	assert.deepEqual(userMessage.payload, {
		kind: 'message',
		parts: [{ kind: 'text', text: 'do the thing' }],
		role: 'user',
	});
	await adapter.shutdown();
});

test('submit emits set_model and set_thinking_level before the prompt when changed', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createCliRpcPiAgentAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession({ metadata: buildMetadata() });
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	await session.submit({
		modelOverride: 'anthropic/claude-sonnet-4',
		prompt: 'go',
		thinkingLevel: 'high',
	});

	const chunks = child.getStdinChunks();
	assert.equal(chunks.length, 3);
	const setModel = JSON.parse(chunks[0] ?? '');
	assert.deepEqual(setModel, {
		modelId: 'claude-sonnet-4',
		provider: 'anthropic',
		type: 'set_model',
	});
	const setThinking = JSON.parse(chunks[1] ?? '');
	assert.deepEqual(setThinking, { level: 'high', type: 'set_thinking_level' });
	assert.match(chunks[2] ?? '', /"type":"prompt"/);
	await adapter.shutdown();
});

test('submit skips set_model when the request matches the spawned model', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createCliRpcPiAgentAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession({
		metadata: buildMetadata({
			model: { id: 'claude-sonnet-4', provider: 'anthropic' },
		}),
	});
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	await session.submit({
		modelOverride: 'anthropic/claude-sonnet-4',
		prompt: 'go',
	});

	const chunks = child.getStdinChunks();
	assert.equal(chunks.length, 1);
	assert.match(chunks[0] ?? '', /"type":"prompt"/);
	assert.doesNotMatch(chunks[0] ?? '', /set_model/);
	await adapter.shutdown();
});

test('submit only re-emits set_model when the selection changes again', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createCliRpcPiAgentAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession({
		metadata: buildMetadata({
			model: { id: 'claude-sonnet-4', provider: 'anthropic' },
		}),
	});
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	await session.submit({ modelOverride: 'openai/gpt-5', prompt: 'one' });
	await session.submit({ modelOverride: 'openai/gpt-5', prompt: 'two' });

	const setModelFrames = child
		.getStdinChunks()
		.filter((chunk) => /set_model/.test(chunk));
	assert.equal(setModelFrames.length, 1);
	await adapter.shutdown();
});

test('subscribing replays current metadata to late listeners', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createCliRpcPiAgentAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession({ metadata: buildMetadata() });
	const child = firstItem(recorder.getChildren());

	child.emitStdout('{"type":"session","sessionId":"replay-99"}\n');

	const events: PiAgentEvent[] = [];
	session.subscribe((event) => events.push(event));
	await waitForMicrotasks();

	const replayed = events.find((event) => event.type === 'metadata');
	assert.ok(replayed);
	assert.equal(
		(replayed as Extract<PiAgentEvent, { type: 'metadata' }>).metadata
			.sessionId,
		'replay-99',
	);
	await adapter.shutdown();
});

test('spawn throwing surfaces as spawn-error and shutdown(crashed)', async () => {
	const adapter = createCliRpcPiAgentAdapter({
		spawn: () => {
			throw new Error('spawn ENOENT');
		},
	});
	const session = await adapter.createSession({ metadata: buildMetadata() });
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();

	const spawnError = events.find(
		(event): event is Extract<PiAgentEvent, { type: 'error' }> =>
			event.type === 'error' && event.error.code === 'spawn-error',
	);
	const shutdown = events.find((event) => event.type === 'shutdown');
	assert.ok(spawnError);
	assert.ok(shutdown);
	assert.equal(
		(shutdown as Extract<PiAgentEvent, { type: 'shutdown' }>).reason,
		'crashed',
	);
});

test('oversize line drops cleanly and reports recoverable error', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createCliRpcPiAgentAdapter({
		maxLineBytes: 64,
		spawn: recorder.spawn,
	});
	const session = await adapter.createSession({ metadata: buildMetadata() });
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	child.emitStdout('x'.repeat(128));
	child.emitStdout('\n{"type":"status","status":"streaming"}\n');

	const oversizeError = events.find(
		(event): event is Extract<PiAgentEvent, { type: 'error' }> =>
			event.type === 'error' && /oversize/.test(event.error.message),
	);
	assert.ok(oversizeError);
	const status = events.find((event) => event.type === 'status');
	assert.ok(status);
	await adapter.shutdown();
});

test('normalizePiPayload projects message_end frames into a composite message', () => {
	const result = normalizePiPayload({
		message: {
			content: [
				{ text: 'Plan', thinking: 'Plan', type: 'thinking' },
				{ text: 'Answer', type: 'text' },
				{
					arguments: { command: 'ls' },
					id: 'call-1',
					name: 'bash',
					type: 'toolCall',
				},
			],
			role: 'assistant',
		},
		type: 'message_end',
	});

	assert.deepEqual(result, {
		kind: 'message',
		parts: [
			{ kind: 'reasoning', text: 'Plan' },
			{ kind: 'text', text: 'Answer' },
			{
				input: { command: 'ls' },
				kind: 'tool-call',
				name: 'bash',
				toolCallId: 'call-1',
			},
		],
		role: 'assistant',
	});
});

test('normalizePiPayload maps tool_execution_end to a tool-result variant', () => {
	const result = normalizePiPayload({
		isError: false,
		result: { content: [{ text: 'ok', type: 'text' }] },
		toolCallId: 'call-99',
		toolName: 'bash',
		type: 'tool_execution_end',
	});

	assert.deepEqual(result, {
		isError: false,
		kind: 'tool-result',
		output: { content: [{ text: 'ok', type: 'text' }] },
		toolCallId: 'call-99',
	});
});

test('normalizePiPayload maps tool_execution_start to a tool-call variant', () => {
	const result = normalizePiPayload({
		args: { path: '/tmp' },
		toolCallId: 'call-1',
		toolName: 'read',
		type: 'tool_execution_start',
	});

	assert.deepEqual(result, {
		input: { path: '/tmp' },
		kind: 'tool-call',
		name: 'read',
		toolCallId: 'call-1',
	});
});

test('normalizePiPayload falls through to an unknown envelope for unrecognized frames', () => {
	const result = normalizePiPayload({ type: 'mystery-frame', wat: 1 });

	assert.deepEqual(result, {
		frameType: 'mystery-frame',
		kind: 'unknown',
		raw: { type: 'mystery-frame', wat: 1 },
	});
});
