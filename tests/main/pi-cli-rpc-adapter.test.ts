import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import type { AgentAdapterCreateSessionInput } from '../../src/main/agent-runtime/agent-adapter.ts';
import type {
	AgentEvent,
	AgentSessionMetadata,
	AgentSessionRequest,
} from '../../src/main/agent-runtime/agent-types.ts';
import { AgentSubmitError } from '../../src/main/agent-runtime/agent-types.ts';
import {
	type ChildLike,
	createPiCliRpcAdapter,
	normalizePiPayload,
	type SpawnFn,
} from '../../src/main/pi-agent/pi-cli-rpc-adapter.ts';

interface FakeChildHandle extends ChildLike {
	emitExit: (code: number | null, signal?: NodeJS.Signals | null) => void;
	emitStderr: (chunk: Buffer | string) => void;
	emitStdinError: (cause: Error) => void;
	emitStdout: (chunk: Buffer | string) => void;
	getKillSignals: () => readonly NodeJS.Signals[];
	getStdinChunks: () => readonly string[];
	setStdinWritable: (value: boolean) => void;
	setPromptAutoResponse: (value: boolean) => void;
	setReadyAutoResponse: (value: boolean) => void;
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
	let promptAutoResponse = true;
	let readyAutoResponse = true;
	const killSignals: NodeJS.Signals[] = [];
	// Model stdin as an EventEmitter so `on('error', …)` wires up like the real
	// pipe socket; `writable` is mutable so tests can simulate a dead pipe.
	const stdinEmitter = new EventEmitter();
	const stdin = Object.assign(stdinEmitter, {
		end: () => undefined,
		once: (_event: string, _handler: () => void) => undefined,
		writable: true,
		write: (
			chunk: string | Buffer,
			_enc?: BufferEncoding | (() => void),
			cb?: () => void,
		) => {
			stdinChunks.push(
				typeof chunk === 'string' ? chunk : chunk.toString('utf8'),
			);
			const frame = JSON.parse(String(chunk)) as Record<string, unknown>;
			if (
				(promptAutoResponse && frame.type === 'prompt') ||
				(readyAutoResponse && frame.type === 'get_state')
			) {
				queueMicrotask(() => {
					stdout.emit(
						'data',
						Buffer.from(
							`${JSON.stringify({
								command: frame.type,
								id: frame.id,
								success: true,
								type: 'response',
							})}\n`,
						),
					);
				});
			}
			if (typeof cb === 'function') {
				cb();
			}
			return true;
		},
	}) as unknown as NodeJS.WritableStream;
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
		emitStdinError: (cause: Error) => {
			stdinEmitter.emit('error', cause);
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
			// Model OS semantics so `close()`, which now awaits real termination,
			// resolves: a process exits on SIGTERM and on the unignorable SIGKILL.
			// SIGINT is left to the test — `abort` models a process that ignores it
			// so the SIGKILL escalation stays observable.
			if (signal === 'SIGTERM' || signal === 'SIGKILL') {
				queueMicrotask(() => emitter.emit('exit', null, signal));
			}
			return true;
		},
		pid: 4242,
		setPromptAutoResponse: (value: boolean) => {
			promptAutoResponse = value;
		},
		setReadyAutoResponse: (value: boolean) => {
			readyAutoResponse = value;
		},
		setStdinWritable: (value: boolean) => {
			(stdin as unknown as { writable: boolean }).writable = value;
		},
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
	overrides: Partial<AgentSessionMetadata> = {},
): AgentSessionMetadata {
	const base: AgentSessionMetadata = {
		args: [],
		command: '/usr/local/bin/pi',
		cwd: '/tmp/ensemblr/ws',
		env: { LANG: 'en_US.UTF-8' },
		id: 'session-1',
		label: 'test session',
		model: null,
		piAgentDirectoryPreserved: true,
		provider: 'pi',
		sessionId: null,
		startedAt: '2026-06-08T00:00:00.000Z',
		status: 'starting',
		thinking: null,
		updatedAt: '2026-06-08T00:00:00.000Z',
	};
	return { ...base, ...overrides };
}

function buildInput(
	overrides: {
		metadata?: Partial<AgentSessionMetadata>;
		request?: Partial<AgentSessionRequest>;
	} = {},
): AgentAdapterCreateSessionInput {
	return {
		metadata: buildMetadata(overrides.metadata),
		request: {
			agentSessionId: 'agent-session-1',
			executable: { command: '/usr/local/bin/pi', status: 'ok' },
			workspaceCwd: '/tmp/ensemblr/ws',
			...overrides.request,
		},
	};
}

function collectEvents(): {
	events: AgentEvent[];
	listener: (event: AgentEvent) => void;
} {
	const events: AgentEvent[] = [];
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

const STATS_PROBE = '"type":"get_session_stats"';

/**
 * What a call under test wrote, minus the startup stats and readiness probes.
 */
function commandChunks(child: FakeChildHandle): readonly string[] {
	return child
		.getStdinChunks()
		.filter(
			(chunk) =>
				!chunk.includes(STATS_PROBE) && !chunk.includes('"type":"get_state"'),
		);
}

test('asks for session stats at spawn, before anything is prompted', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	await adapter.createSession(buildInput());
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	assert.match(firstItem(child.getStdinChunks()), /"type":"get_session_stats"/);
	await adapter.shutdown();
});

test('reports the window the spawn-time stats probe answers with', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());
	const probe = JSON.parse(firstItem(child.getStdinChunks())) as { id: string };

	child.emitStdout(
		`${JSON.stringify({
			command: 'get_session_stats',
			data: {
				contextUsage: { contextWindow: 1_000_000, percent: 0, tokens: 0 },
			},
			id: probe.id,
			success: true,
			type: 'response',
		})}\n`,
	);

	assert.deepEqual(
		events.flatMap((event) =>
			event.type === 'context-usage' ? [event.usage] : [],
		),
		[{ contextWindow: 1_000_000, percent: 0, tokens: 0 }],
	);
	await adapter.shutdown();
});

test('spawns the executable with metadata cwd, args, and merged env', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());

	assert.equal(session.id, 'session-1');
	const records = recorder.getRecords();
	assert.equal(records.length, 1);
	const record = firstItem(records);
	assert.equal(record.command, '/usr/local/bin/pi');
	assert.deepEqual(record.args, ['--mode', 'rpc']);
	assert.equal(record.cwd, '/tmp/ensemblr/ws');
	assert.equal(record.env.LANG, 'en_US.UTF-8');
	await adapter.shutdown();
});

test('builds Pi selection flags from the provider-neutral request', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(
		buildInput({
			metadata: { sessionId: 'native-2' },
			request: {
				modelOverride: 'anthropic/claude-sonnet-4',
				thinkingLevel: 'high',
			},
		}),
	);

	assert.deepEqual(firstItem(recorder.getRecords()).args, [
		'--mode',
		'rpc',
		'--model',
		'anthropic/claude-sonnet-4',
		'--thinking',
		'high',
		'--session-id',
		'native-2',
	]);
	assert.deepEqual(session.getMetadata().args, [
		'--mode',
		'rpc',
		'--model',
		'anthropic/claude-sonnet-4',
		'--thinking',
		'high',
		'--session-id',
		'native-2',
	]);
	await adapter.shutdown();
});

test('omits model and thinking flags when the request leaves them blank', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	await adapter.createSession(
		buildInput({ request: { modelOverride: '   ', thinkingLevel: null } }),
	);

	assert.deepEqual(firstItem(recorder.getRecords()).args, ['--mode', 'rpc']);
	await adapter.shutdown();
});

test('prepends caller-supplied base args, such as the control extension', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({
		baseArgs: () => ['--mode', 'rpc', '-e', '/opt/ensemblr-control.mts'],
		spawn: recorder.spawn,
	});
	await adapter.createSession(
		buildInput({ request: { modelOverride: 'openai/gpt-5' } }),
	);

	assert.deepEqual(firstItem(recorder.getRecords()).args, [
		'--mode',
		'rpc',
		'-e',
		'/opt/ensemblr-control.mts',
		'--model',
		'openai/gpt-5',
	]);
	await adapter.shutdown();
});

test('spawns the Pi child under the resolved base environment', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({
		// Production wires this to the login-shell env; a Finder-launched packaged
		// app was instead spawning under process.env's minimal PATH, so pi exited
		// on startup and the first prompt write hit EPIPE.
		resolveBaseEnv: () => ({
			HOME: '/Users/dev',
			PATH: '/opt/homebrew/bin:/usr/bin:/bin',
		}),
		spawn: recorder.spawn,
	});
	await adapter.createSession(buildInput());

	const record = firstItem(recorder.getRecords());
	// Base env (shell PATH + HOME) is present, and the per-session overlay layers
	// on top.
	assert.equal(record.env.PATH, '/opt/homebrew/bin:/usr/bin:/bin');
	assert.equal(record.env.HOME, '/Users/dev');
	assert.equal(record.env.LANG, 'en_US.UTF-8');
	await adapter.shutdown();
});

test('a recovered WebSocket error never becomes a fatal turn failure', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	child.emitStdout('{"type":"agent_start"}\n');
	child.emitStdout(
		'{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"WebSocket error"}}\n',
	);
	assert.equal(events.filter((event) => event.type === 'error').length, 0);
	child.emitStdout('{"type":"agent_end","willRetry":true}\n');
	child.emitStdout('{"type":"auto_retry_start","attempt":1}\n');
	child.emitStdout('{"type":"agent_start"}\n');
	child.emitStdout(
		'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Done."}],"stopReason":"stop"}}\n',
	);
	assert.ok(
		events.some(
			(event) =>
				event.type === 'message' &&
				event.payload.kind === 'message' &&
				event.payload.endsResponse === true,
		),
	);
	child.emitStdout('{"type":"auto_retry_end","success":true}\n');
	child.emitStdout('{"type":"agent_end","willRetry":false}\n');
	assert.equal(session.getMetadata().status, 'streaming');
	child.emitStdout('{"type":"agent_settled"}\n');

	assert.equal(session.getMetadata().status, 'idle');
	assert.equal(events.filter((event) => event.type === 'error').length, 0);
	assert.equal(
		events.filter(
			(event) => event.type === 'message' && event.payload.kind === 'unknown',
		).length,
		0,
	);
	await adapter.shutdown();
});

test('exhausted retries surface one fatal error only when Pi settles', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	child.emitStdout('{"type":"agent_start"}\n');
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		child.emitStdout(
			'{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"WebSocket error"}}\n',
		);
		child.emitStdout('{"type":"agent_end","willRetry":true}\n');
		child.emitStdout('{"type":"auto_retry_start"}\n');
	}
	child.emitStdout(
		'{"type":"auto_retry_end","success":false,"finalError":"Connection closed after retries"}\n',
	);
	assert.equal(events.filter((event) => event.type === 'error').length, 0);
	child.emitStdout('{"type":"agent_settled"}\n');
	child.emitStdout('{"type":"agent_settled"}\n');

	const errors = events.filter((event) => event.type === 'error');
	assert.equal(errors.length, 1);
	assert.equal(errors[0]?.error.message, 'Connection closed after retries');
	assert.equal(errors[0]?.error.recoverable, false);
	assert.equal(session.getMetadata().status, 'idle');
	await adapter.shutdown();
});

test('a terminal failure without retries remains visible and the next turn can recover', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());
	child.emitStdout('{"type":"agent_start"}\n');
	child.emitStdout(
		'{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"WebSocket error"}}\n',
	);
	child.emitStdout(
		'{"type":"agent_end","willRetry":false}\n{"type":"agent_settled"}\n',
	);
	const errors = events.filter((event) => event.type === 'error');
	assert.equal(errors.length, 1);
	assert.equal(errors[0]?.error.message, 'WebSocket error');
	assert.equal(errors[0]?.error.recoverable, false);
	child.emitStdout('{"type":"agent_start"}\n');
	child.emitStdout(
		'{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"again"}]}}\n',
	);
	child.emitStdout(
		'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Done"}],"stopReason":"stop"}}\n',
	);
	child.emitStdout('{"type":"agent_settled"}\n');
	assert.equal(events.filter((event) => event.type === 'error').length, 1);
	await adapter.shutdown();
});

test('queued sends wait for settlement across retry and compaction boundaries', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const sends: Promise<unknown>[] = [];
	session.subscribe((event) => {
		if (event.type === 'status' && event.status === 'idle') {
			sends.push(session.submit({ prompt: 'queued follow-up' }));
		}
	});
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	child.emitStdout('{"type":"agent_start"}\n');
	for (const willRetry of [true, false]) {
		child.emitStdout(`${JSON.stringify({ type: 'agent_end', willRetry })}\n`);
		await waitForMicrotasks();
		assert.equal(session.getMetadata().status, 'streaming');
		assert.equal(commandChunks(child).length, 0);
	}
	child.emitStdout('{"type":"agent_settled"}\n');
	await Promise.all(sends);
	assert.equal(commandChunks(child).length, 1);
	assert.match(commandChunks(child)[0] ?? '', /queued follow-up/);
	await adapter.shutdown();
});

test('parses JSONL frames into typed events', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
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
		(messageEvent as Extract<AgentEvent, { type: 'message' }>).role,
		'agent',
	);
	assert.ok(metadataEvents.length >= 1);
	const last = metadataEvents.at(-1);
	assert.equal(
		(last as Extract<AgentEvent, { type: 'metadata' }>).metadata.sessionId,
		'pi-runtime-9',
	);
	await adapter.shutdown();
});

test('raw frames name the agent_sessions.id the debug panel scopes by', async () => {
	const recorder = createSpawnRecorder();
	const frames: Array<{ sessionId: string }> = [];
	const adapter = createPiCliRpcAdapter({
		onRawFrame: (frame) => frames.push(frame),
		spawn: recorder.spawn,
	});
	await adapter.createSession(
		buildInput({
			metadata: { id: 'runtime-handle-1' },
			request: { agentSessionId: 'agent-session-7' },
		}),
	);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	child.emitStdout(
		'{"type":"message","role":"agent","payload":{"text":"hi"}}\n',
	);

	assert.ok(frames.length >= 1);
	for (const frame of frames) {
		assert.equal(frame.sessionId, 'agent-session-7');
	}
	await adapter.shutdown();
});

test('invalid JSON lines surface as recoverable error events', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	child.emitStdout('not-json-{{{\n');

	const errorEvent = events.find(
		(event): event is Extract<AgentEvent, { type: 'error' }> =>
			event.type === 'error',
	);
	assert.ok(errorEvent);
	assert.equal(errorEvent.error.recoverable, true);
	assert.match(errorEvent.error.message, /Invalid JSON/);
	await adapter.shutdown();
});

test('stderr chunks emit recoverable error events tagged "Pi RPC stderr"', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	child.emitStderr('warning: deprecated flag\n');

	const stderrEvent = events.find(
		(event): event is Extract<AgentEvent, { type: 'error' }> =>
			event.type === 'error' && event.error.message === 'Pi RPC stderr',
	);
	assert.ok(stderrEvent);
	assert.equal(stderrEvent.error.recoverable, true);
	assert.equal(stderrEvent.error.detail, 'warning: deprecated flag\n');
	await adapter.shutdown();
});

test('crash with non-zero exit emits error then shutdown(crashed)', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	child.emitExit(137, 'SIGKILL');

	const shutdown = events.find((event) => event.type === 'shutdown');
	const errorEvents = events.filter((event) => event.type === 'error');
	assert.ok(shutdown);
	assert.equal(
		(shutdown as Extract<AgentEvent, { type: 'shutdown' }>).reason,
		'crashed',
	);
	assert.ok(
		errorEvents.some((event) =>
			/exited with code 137/.test(event.error.message),
		),
	);
});

test('crash detail carries the signal and the stderr tail', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	child.emitStderr('panic: out of memory\n');
	child.emitExit(137, 'SIGKILL');

	const crash = events.find(
		(event): event is Extract<AgentEvent, { type: 'error' }> =>
			event.type === 'error' &&
			/exited with code 137/.test(event.error.message),
	);
	assert.ok(crash);
	assert.equal(crash.error.recoverable, false);
	assert.match(crash.error.detail ?? '', /signal=SIGKILL/);
	assert.match(crash.error.detail ?? '', /panic: out of memory/);
});

test('graceful termination signals exit without an error diagnostic', async () => {
	for (const [code, signal] of [
		[143, null],
		[130, null],
		[null, 'SIGTERM'],
	] as const) {
		const recorder = createSpawnRecorder();
		const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
		const session = await adapter.createSession(buildInput());
		const { events, listener } = collectEvents();
		session.subscribe(listener);
		await waitForMicrotasks();
		const child = firstItem(recorder.getChildren());

		child.emitExit(code, signal);

		assert.deepEqual(
			events.filter((event) => event.type === 'error'),
			[],
			`expected no error for code=${code} signal=${signal}`,
		);
		assert.ok(events.some((event) => event.type === 'shutdown'));
	}
});

test('abort flushes a prompt pi never echoed so the transcript keeps it', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({
		killGraceMs: 5,
		spawn: recorder.spawn,
	});
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();

	await session.submit({ prompt: 'okay howdy' });
	await session.abort('user clicked stop');
	await new Promise((resolve) => setTimeout(resolve, 25));

	const userMessages = events.filter(
		(event) => event.type === 'message' && event.role === 'user',
	);
	assert.equal(userMessages.length, 1);
	const flushed = userMessages[0] as Extract<AgentEvent, { type: 'message' }>;
	assert.deepEqual(flushed.payload, {
		kind: 'message',
		parts: [{ kind: 'text', text: 'okay howdy' }],
		role: 'user',
	});
	// The prompt has to precede the shutdown so the timeline renders it above
	// the "you stopped this turn" marker rather than after it.
	const shutdownIndex = events.findIndex((event) => event.type === 'shutdown');
	assert.ok(shutdownIndex >= 0);
	assert.ok(events.indexOf(flushed) < shutdownIndex);
});

test('a prompt echo buffered past the abort does not duplicate the flush', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({
		killGraceMs: 5000,
		spawn: recorder.spawn,
	});
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	await session.submit({ prompt: 'okay howdy' });
	await session.abort('user clicked stop');
	// Pi buffered the echo before the SIGINT landed; it arrives while the child
	// is still winding down, after `abort` already surfaced the prompt.
	child.emitStdout(
		'{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"okay howdy"}]}}\n',
	);

	const userMessages = events.filter(
		(event) => event.type === 'message' && event.role === 'user',
	);
	assert.equal(userMessages.length, 1);
});

test('abort does not re-emit a prompt pi already echoed back', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	await session.submit({ prompt: 'okay howdy' });
	child.emitStdout(
		'{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"okay howdy"}]}}\n',
	);
	await session.abort('user clicked stop');

	const userMessages = events.filter(
		(event) => event.type === 'message' && event.role === 'user',
	);
	assert.equal(userMessages.length, 1);
});

test('abort does not re-emit a skill prompt pi echoed back expanded', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	// Pi expands `/skill:name args` into a `<skill>` block before echoing it, so
	// the echo never equals the queued command; the skill key must still retire
	// it or shutdown re-emits the raw prompt as a duplicate user message.
	await session.submit({ prompt: '/skill:caveman write me a poem' });
	const expanded = [
		'<skill name="caveman" location="/skills/caveman/SKILL.md">',
		'Respond terse like smart caveman.',
		'</skill>',
		'',
		'write me a poem',
	].join('\n');
	child.emitStdout(
		`${JSON.stringify({
			message: { content: [{ text: expanded, type: 'text' }], role: 'user' },
			type: 'message_end',
		})}\n`,
	);
	await session.abort('user clicked stop');

	const userMessages = events.filter(
		(event) => event.type === 'message' && event.role === 'user',
	);
	assert.equal(userMessages.length, 1);
});

test('a crash surfaces a prompt pi never echoed instead of dropping it', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	await session.submit({ prompt: 'okay howdy' });
	// The child dies before echoing the prompt back and nothing called `abort`,
	// so only the shutdown path can keep the prompt in the transcript.
	child.emitExit(1, null);

	const userMessages = events.filter(
		(event): event is Extract<AgentEvent, { type: 'message' }> =>
			event.type === 'message' && event.role === 'user',
	);
	assert.equal(userMessages.length, 1);
	const flushed = firstItem(userMessages);
	assert.deepEqual(flushed.payload, {
		kind: 'message',
		parts: [{ kind: 'text', text: 'okay howdy' }],
		role: 'user',
	});
	const shutdownIndex = events.findIndex((event) => event.type === 'shutdown');
	assert.ok(shutdownIndex >= 0);
	assert.ok(events.indexOf(flushed) < shutdownIndex);
});

test('app quit surfaces a prompt pi never echoed instead of dropping it', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({
		killGraceMs: 5,
		spawn: recorder.spawn,
	});
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();

	await session.submit({ prompt: 'okay howdy' });
	// App quit closes every open session directly; it never routes through
	// `abort`, so the flush cannot live on that path alone.
	await adapter.shutdown();

	const userMessages = events.filter(
		(event): event is Extract<AgentEvent, { type: 'message' }> =>
			event.type === 'message' && event.role === 'user',
	);
	assert.equal(userMessages.length, 1);
	const flushed = firstItem(userMessages);
	assert.deepEqual(flushed.payload, {
		kind: 'message',
		parts: [{ kind: 'text', text: 'okay howdy' }],
		role: 'user',
	});
	const shutdownIndex = events.findIndex((event) => event.type === 'shutdown');
	assert.ok(shutdownIndex >= 0);
	assert.ok(events.indexOf(flushed) < shutdownIndex);
});

test('a steer echo does not duplicate the surfaced steer or retire the plain prompt', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({
		killGraceMs: 5,
		spawn: recorder.spawn,
	});
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	await session.submit({ prompt: 'okay howdy' });
	await session.submit({ prompt: 'go this way', streamingBehavior: 'steer' });
	// The steer is surfaced optimistically, so its later echo must be dropped
	// without retiring the plain prompt still waiting for its own echo.
	child.emitStdout(
		'{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"go this way"}]}}\n',
	);
	await session.abort('user clicked stop');

	const userMessages = events.filter(
		(event): event is Extract<AgentEvent, { type: 'message' }> =>
			event.type === 'message' && event.role === 'user',
	);
	assert.deepEqual(
		userMessages.map((event) => event.payload),
		[
			{
				kind: 'message',
				parts: [{ kind: 'text', text: 'go this way' }],
				role: 'user',
			},
			{
				kind: 'message',
				parts: [{ kind: 'text', text: 'okay howdy' }],
				role: 'user',
			},
		],
	);
});

test('a repeated abort duplicates nothing and re-arms no kill timer', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({
		killGraceMs: 5,
		spawn: recorder.spawn,
	});
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	await session.submit({ prompt: 'okay howdy' });
	// Two stops inside the SIGINT → SIGKILL grace window: the child has not
	// exited yet, so `closed` is still false and the second call re-enters.
	await session.abort('user clicked stop');
	await session.abort('user clicked stop again');
	await new Promise((resolve) => setTimeout(resolve, 25));

	const userMessages = events.filter(
		(event) => event.type === 'message' && event.role === 'user',
	);
	const abortErrors = events.filter(
		(event) =>
			event.type === 'error' &&
			event.error.message === 'Pi RPC session aborted.',
	);
	assert.equal(userMessages.length, 1);
	assert.equal(abortErrors.length, 1);
	const signals = child.getKillSignals();
	assert.equal(signals.filter((signal) => signal === 'SIGINT').length, 1);
	assert.equal(signals.filter((signal) => signal === 'SIGKILL').length, 1);
});

test('abort signals SIGINT then SIGKILL after the grace window', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({
		killGraceMs: 5,
		spawn: recorder.spawn,
	});
	const session = await adapter.createSession(buildInput());
	await session.abort('user clicked stop');
	const child = firstItem(recorder.getChildren());

	await new Promise((resolve) => setTimeout(resolve, 25));
	const signals = child.getKillSignals();
	assert.ok(signals.includes('SIGINT'));
	assert.ok(signals.includes('SIGKILL'));

	// Emit exit so listeners clean up and the test exits cleanly.
	child.emitExit(null, 'SIGKILL');
});

test('submit waits for a correlated Pi acceptance and propagates rejection', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const child = firstItem(recorder.getChildren());
	child.setPromptAutoResponse(false);
	let settled = false;
	const submission = session.submit({ prompt: 'queued follow-up' });
	void submission.then(
		() => {
			settled = true;
		},
		() => {
			settled = true;
		},
	);
	const rejection = assert.rejects(submission, /still streaming/);
	await waitForMicrotasks();
	assert.equal(settled, false);
	const frame = JSON.parse(commandChunks(child)[0] ?? '{}') as { id: string };
	assert.equal(typeof frame.id, 'string');
	child.emitStdout(
		'{"type":"response","command":"prompt","id":"unrelated","success":true}\n',
	);
	await waitForMicrotasks();
	assert.equal(settled, false);
	child.emitStdout(
		`${JSON.stringify({
			command: 'prompt',
			id: frame.id,
			success: false,
			error: 'Agent is still streaming',
			type: 'response',
		})}\n`,
	);
	await rejection;
	await adapter.shutdown();
});

test('cold startup waits for correlated readiness before writing one prompt', async (t) => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const child = firstItem(recorder.getChildren());
	child.setReadyAutoResponse(false);
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const submission = session.submit({ prompt: 'cold start' });
	await waitForMicrotasks();
	t.mock.timers.tick(30_000);
	await waitForMicrotasks();
	assert.equal(commandChunks(child).length, 0);
	const probe = child
		.getStdinChunks()
		.map((chunk) => JSON.parse(chunk) as Record<string, unknown>)
		.find((frame) => frame.type === 'get_state');
	assert.ok(probe);
	child.emitStdout(
		'{"type":"response","command":"get_state","id":"unrelated","success":true}\n',
	);
	await waitForMicrotasks();
	assert.equal(commandChunks(child).length, 0);
	child.emitStdout(
		`${JSON.stringify({ type: 'response', command: 'get_state', id: probe.id, success: true })}\n`,
	);
	await submission;
	assert.equal(commandChunks(child).length, 1);
	await session.submit({ prompt: 'warm start' });
	assert.equal(
		child
			.getStdinChunks()
			.filter((chunk) => chunk.includes('"type":"get_state"')).length,
		1,
	);
	t.mock.timers.reset();
	await adapter.shutdown();
});

test('startup timeout closes the child without writing or quarantining a prompt', async (t) => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const child = firstItem(recorder.getChildren());
	child.setReadyAutoResponse(false);
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const rejection = assert.rejects(
		session.submit({ prompt: 'never delivered' }),
		(error: unknown) => {
			assert.ok(error instanceof AgentSubmitError);
			assert.equal(error.disposition, 'rejected');
			assert.match(error.message, /startup failed before prompt delivery/);
			return true;
		},
	);
	await waitForMicrotasks();
	t.mock.timers.tick(120_000);
	await rejection;
	assert.equal(commandChunks(child).length, 0);
	assert.equal(session.getMetadata().status, 'closed');
	t.mock.timers.reset();
	await adapter.shutdown();
});

test('slow preflight accepts the original prompt without replay or quarantine', async (t) => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const child = firstItem(recorder.getChildren());
	child.setPromptAutoResponse(false);
	t.mock.timers.enable({ apis: ['setTimeout'] });
	let settled = false;
	const submission = session.submit({ prompt: 'compact before answering' });
	void submission.then(
		() => {
			settled = true;
		},
		() => {
			settled = true;
		},
	);
	await waitForMicrotasks();
	child.emitStdout('{"type":"compaction_start","reason":"threshold"}\n');
	t.mock.timers.tick(125_000);
	await waitForMicrotasks();
	assert.equal(settled, false);
	const frame = JSON.parse(commandChunks(child)[0] ?? '{}') as { id: string };
	child.emitStdout(
		`${JSON.stringify({ type: 'response', command: 'prompt', id: frame.id, success: true })}\n`,
	);
	await submission;
	assert.equal(commandChunks(child).length, 1);
	assert.deepEqual(child.getKillSignals(), []);
	t.mock.timers.reset();
	await adapter.shutdown();
});

test('unacknowledged prompt times out instead of reporting successful delivery', async (t) => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const child = firstItem(recorder.getChildren());
	child.setPromptAutoResponse(false);
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const submission = session.submit({ prompt: 'missing delivery' });
	const rejection = assert.rejects(
		submission,
		/delivery could not be confirmed/,
	);
	await waitForMicrotasks();
	t.mock.timers.tick(180_000);
	await rejection;
	t.mock.timers.reset();
	await adapter.shutdown();
});

test('runtime exit rejects an outstanding prompt acceptance', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const child = firstItem(recorder.getChildren());
	child.setPromptAutoResponse(false);
	const submission = session.submit({ prompt: 'pending delivery' });
	const rejection = assert.rejects(submission, (error: unknown) => {
		assert.ok(error instanceof AgentSubmitError);
		assert.equal(error.disposition, 'unconfirmed');
		assert.match(error.message, /closed before command acceptance/);
		return true;
	});
	await waitForMicrotasks();
	child.emitExit(1);
	await rejection;
	await adapter.shutdown();
});

test('async pipe failure after a prompt write is unconfirmed without waiting for exit', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const child = firstItem(recorder.getChildren());
	child.setPromptAutoResponse(false);
	const rejection = assert.rejects(
		session.submit({ prompt: 'possibly delivered' }),
		(error: unknown) => {
			assert.ok(error instanceof AgentSubmitError);
			assert.equal(error.disposition, 'unconfirmed');
			assert.match(error.message, /EPIPE/);
			return true;
		},
	);
	await waitForMicrotasks();
	child.emitStdinError(new Error('write EPIPE'));
	await rejection;
	assert.equal(commandChunks(child).length, 1);
	await adapter.shutdown();
});

test('asynchronous spawn failure closes the session without an exit event', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const child = firstItem(recorder.getChildren());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	child.emit('error', new Error('spawn pi ENOENT'));
	child.emit('close', -2, null);
	assert.equal(session.getMetadata().status, 'closed');
	assert.equal(events.filter((event) => event.type === 'shutdown').length, 1);
	await assert.rejects(session.submit({ prompt: 'never written' }));
	assert.equal(commandChunks(child).length, 0);
	await adapter.shutdown();
});

test('rejected prompts are not later flushed as delivered user messages', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	const child = firstItem(recorder.getChildren());
	child.setPromptAutoResponse(false);
	const submission = session.submit({ prompt: 'rejected delivery' });
	const rejection = assert.rejects(submission, /still streaming/);
	await waitForMicrotasks();
	const frame = JSON.parse(commandChunks(child)[0] ?? '{}') as { id: string };
	child.emitStdout(
		`${JSON.stringify({
			command: 'prompt',
			id: frame.id,
			success: false,
			error: 'Agent is still streaming',
			type: 'response',
		})}\n`,
	);
	await rejection;
	await session.abort();
	assert.equal(
		events.filter((event) => event.type === 'message' && event.role === 'user')
			.length,
		0,
	);
	await adapter.shutdown();
});

test('a prompt ack cannot restart a turn that already settled', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const child = firstItem(recorder.getChildren());
	child.setPromptAutoResponse(false);
	const submission = session.submit({ prompt: 'quick answer' });
	await waitForMicrotasks();
	const frame = JSON.parse(commandChunks(child)[0] ?? '{}') as { id: string };
	child.emitStdout(
		`${JSON.stringify({
			command: 'prompt',
			id: frame.id,
			success: true,
			type: 'response',
		})}\n{"type":"agent_start"}\n{"type":"agent_end"}\n{"type":"agent_settled"}\n`,
	);
	await submission;
	assert.equal(session.getMetadata().status, 'idle');
	await adapter.shutdown();
});

test('submit writes a JSONL frame to stdin and waits for Pi user echo', async () => {
	let turnCounter = 0;
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({
		spawn: recorder.spawn,
		turnIdFactory: () => `turn-${++turnCounter}`,
	});
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	const ack = await session.submit({ prompt: 'do the thing' });
	assert.match(ack.turnId, /^turn-\d+$/);

	const stdinChunks = commandChunks(child);
	assert.equal(stdinChunks.length, 1);
	const firstStdinChunk = stdinChunks[0];
	assert.ok(firstStdinChunk);
	assert.match(firstStdinChunk, new RegExp(`"turnId":"${ack.turnId}"`));
	// Pi RPC protocol (@earendil-works/pi-coding-agent): `prompt` command
	// with `message` field, one JSONL frame per line.
	assert.match(firstStdinChunk, /"type":"prompt"/);
	assert.match(firstStdinChunk, /"message":"do the thing"/);
	assert.match(firstStdinChunk, /\n$/);

	const syntheticUserMessage = events.find(
		(event): event is Extract<AgentEvent, { type: 'message' }> =>
			event.type === 'message' && event.role === 'user',
	);
	assert.equal(syntheticUserMessage, undefined);

	child.emitStdout(
		'{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"do the thing"}]}}\n',
	);
	const userMessage = events.find(
		(event): event is Extract<AgentEvent, { type: 'message' }> =>
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

test('setSessionName writes a set_session_name frame to stdin', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	await session.setSessionName('  Refactor auth  ');

	const frame = firstItem(commandChunks(child));
	assert.match(frame, /"type":"set_session_name"/);
	assert.match(frame, /"name":"Refactor auth"/);
	assert.match(frame, /\n$/);
	await adapter.shutdown();
});

test('setSessionName rejects a blank name without writing a frame', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	await assert.rejects(() => session.setSessionName('   '), /empty/i);
	assert.equal(commandChunks(child).length, 0);
	await adapter.shutdown();
});

test('absorbs an async stdin EPIPE as a recoverable error, never uncaught', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	// The kernel reports EPIPE on the stdin pipe when the Pi child dies mid-turn.
	// Without the adapter's `stdin.on('error')` listener this would surface as an
	// uncaught exception and crash the main process (the production regression).
	child.emitStdinError(new Error('write EPIPE'));

	const errorEvent = events.find(
		(event): event is Extract<AgentEvent, { type: 'error' }> =>
			event.type === 'error' && event.error.code === 'submit-failed',
	);
	assert.ok(errorEvent);
	assert.equal(errorEvent.error.recoverable, true);
	assert.match(errorEvent.error.message, /stdin write failed/i);
	await adapter.shutdown();
});

test('submit rejects with a typed error when the stdin pipe is dead', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	// Simulate a dead pipe (child exited): stdin is no longer writable.
	child.setStdinWritable(false);

	await assert.rejects(
		() => session.submit({ prompt: 'do the thing' }),
		/not writable/,
	);
	// The frame is never handed to the broken pipe.
	assert.equal(commandChunks(child).length, 0);
	await adapter.shutdown();
});

test('a later same-text prompt is not consumed by an old injection echo guard', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({
		killGraceMs: 5,
		spawn: recorder.spawn,
	});
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	await session.submit({ prompt: 'repeat this', streamingBehavior: 'steer' });
	await session.submit({ prompt: 'repeat this' });
	child.emitStdout(
		'{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"repeat this"}]}}\n',
	);

	const userMessages = events.filter(
		(event): event is Extract<AgentEvent, { type: 'message' }> =>
			event.type === 'message' && event.role === 'user',
	);
	assert.equal(userMessages.length, 2);
	await adapter.shutdown();
});

test('submit with streamingBehavior:steer writes a steer frame and immediately surfaces it', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	await session.submit({ prompt: 'go this way', streamingBehavior: 'steer' });

	const chunks = commandChunks(child);
	assert.equal(chunks.length, 1);
	assert.match(chunks[0] ?? '', /"type":"steer"/);
	assert.match(chunks[0] ?? '', /"message":"go this way"/);
	assert.doesNotMatch(chunks[0] ?? '', /"type":"prompt"/);
	assert.deepEqual(
		events
			.filter(
				(event): event is Extract<AgentEvent, { type: 'message' }> =>
					event.type === 'message' && event.role === 'user',
			)
			.map((event) => event.payload),
		[
			{
				kind: 'message',
				parts: [{ kind: 'text', text: 'go this way' }],
				role: 'user',
			},
		],
	);
	await adapter.shutdown();
});

test('submit with streamingBehavior:followUp writes a follow_up frame and surfaces it', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	await session.submit({
		// A model override must NOT trigger set_model on a mid-turn injection.
		modelOverride: 'openai/gpt-5',
		prompt: 'and then this',
		streamingBehavior: 'followUp',
	});

	const chunks = commandChunks(child);
	assert.equal(chunks.length, 1);
	assert.match(chunks[0] ?? '', /"type":"follow_up"/);
	assert.match(chunks[0] ?? '', /"message":"and then this"/);
	assert.doesNotMatch(chunks[0] ?? '', /"type":"set_model"/);
	assert.deepEqual(
		events
			.filter(
				(event): event is Extract<AgentEvent, { type: 'message' }> =>
					event.type === 'message' && event.role === 'user',
			)
			.map((event) => event.payload),
		[
			{
				kind: 'message',
				parts: [{ kind: 'text', text: 'and then this' }],
				role: 'user',
			},
		],
	);
	await adapter.shutdown();
});

test('submit emits set_model and set_thinking_level before the prompt when changed', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	await session.submit({
		modelOverride: 'anthropic/claude-sonnet-4',
		prompt: 'go',
		thinkingLevel: 'high',
	});

	const chunks = commandChunks(child);
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
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(
		// The request's model becomes the spawn `--model` flag, which seeds the
		// applied-model tracking, so the first prompt must not re-assert it.
		buildInput({
			metadata: { model: { id: 'claude-sonnet-4', provider: 'anthropic' } },
			request: { modelOverride: 'anthropic/claude-sonnet-4' },
		}),
	);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	await session.submit({
		modelOverride: 'anthropic/claude-sonnet-4',
		prompt: 'go',
	});

	const chunks = commandChunks(child);
	assert.equal(chunks.length, 1);
	assert.match(chunks[0] ?? '', /"type":"prompt"/);
	assert.doesNotMatch(chunks[0] ?? '', /set_model/);
	await adapter.shutdown();
});

test('submit skips set_thinking_level when the request matches the spawned level', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(
		// The request's thinking level becomes the spawn `--thinking` flag, which
		// seeds the applied-thinking tracking, so the first prompt must not
		// redundantly re-assert the same level.
		buildInput({ request: { thinkingLevel: 'high' } }),
	);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	await session.submit({ prompt: 'go', thinkingLevel: 'high' });

	const chunks = commandChunks(child);
	assert.equal(chunks.length, 1);
	assert.match(chunks[0] ?? '', /"type":"prompt"/);
	assert.doesNotMatch(chunks[0] ?? '', /set_thinking_level/);
	await adapter.shutdown();
});

test('submit ignores a malformed model override and warns instead of sending it', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	const warnings: unknown[][] = [];
	const originalWarn = console.warn;
	console.warn = (...args: unknown[]) => {
		warnings.push(args);
	};
	try {
		await session.submit({
			modelOverride: 'no-provider-segment',
			prompt: 'go',
		});
	} finally {
		console.warn = originalWarn;
	}

	const chunks = commandChunks(child);
	assert.equal(chunks.length, 1);
	assert.match(chunks[0] ?? '', /"type":"prompt"/);
	assert.doesNotMatch(chunks[0] ?? '', /set_model/);
	assert.ok(
		warnings.some((entry) => /malformed model override/.test(String(entry[0]))),
	);
	await adapter.shutdown();
});

test('submit only re-emits set_model when the selection changes again', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(
		buildInput({
			metadata: { model: { id: 'claude-sonnet-4', provider: 'anthropic' } },
		}),
	);
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
	const adapter = createPiCliRpcAdapter({ spawn: recorder.spawn });
	const session = await adapter.createSession(buildInput());
	const child = firstItem(recorder.getChildren());

	child.emitStdout('{"type":"session","sessionId":"replay-99"}\n');

	const events: AgentEvent[] = [];
	session.subscribe((event) => events.push(event));
	await waitForMicrotasks();

	const replayed = events.find((event) => event.type === 'metadata');
	assert.ok(replayed);
	assert.equal(
		(replayed as Extract<AgentEvent, { type: 'metadata' }>).metadata.sessionId,
		'replay-99',
	);
	await adapter.shutdown();
});

test('spawn throwing surfaces as spawn-error and shutdown(crashed)', async () => {
	const adapter = createPiCliRpcAdapter({
		spawn: () => {
			throw new Error('spawn ENOENT');
		},
	});
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();

	const spawnError = events.find(
		(event): event is Extract<AgentEvent, { type: 'error' }> =>
			event.type === 'error' && event.error.code === 'spawn-error',
	);
	const shutdown = events.find((event) => event.type === 'shutdown');
	assert.ok(spawnError);
	assert.ok(shutdown);
	assert.equal(
		(shutdown as Extract<AgentEvent, { type: 'shutdown' }>).reason,
		'crashed',
	);
});

test('agent_settled finishes a run whose aggregate agent_end frame was oversized', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({
		maxLineBytes: 256,
		spawn: recorder.spawn,
	});
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	child.emitStdout('{"type":"agent_start"}\n');
	child.emitStdout(
		'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}\n',
	);
	child.emitStdout(
		`${JSON.stringify({ type: 'agent_end', messages: ['x'.repeat(512)] })}\n`,
	);
	child.emitStdout('{"type":"agent_settled"}\n');

	const assistantMessage = events.find(
		(event) => event.type === 'message' && event.role === 'agent',
	);
	assert.ok(assistantMessage);
	assert.equal(session.getMetadata().status, 'idle');
	await adapter.shutdown();
});

test('oversize line drops cleanly and reports recoverable error', async () => {
	const recorder = createSpawnRecorder();
	const adapter = createPiCliRpcAdapter({
		maxLineBytes: 64,
		spawn: recorder.spawn,
	});
	const session = await adapter.createSession(buildInput());
	const { events, listener } = collectEvents();
	session.subscribe(listener);
	await waitForMicrotasks();
	const child = firstItem(recorder.getChildren());

	child.emitStdout('x'.repeat(128));
	child.emitStdout('\n{"type":"status","status":"streaming"}\n');

	const oversizeError = events.find(
		(event): event is Extract<AgentEvent, { type: 'error' }> =>
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

test('normalizePiPayload keeps an extension-injected message off the text path', () => {
	const result = normalizePiPayload({
		message: {
			content: '[Context7 Docs: tailwind]\n# Usage',
			customType: 'context7_docs',
			display: false,
			role: 'custom',
		},
		type: 'message_end',
	});

	assert.deepEqual(result, {
		customType: 'context7_docs',
		display: false,
		kind: 'custom',
		text: '[Context7 Docs: tailwind]\n# Usage',
	});
});

test('normalizePiPayload joins the text blocks of an injected message', () => {
	const result = normalizePiPayload({
		message: {
			content: [
				{ text: 'first', type: 'text' },
				{ data: '…', type: 'image' },
				{ text: 'second', type: 'text' },
			],
			customType: 'notes',
			display: true,
			role: 'custom',
		},
		type: 'message_end',
	});

	assert.deepEqual(result, {
		customType: 'notes',
		display: true,
		kind: 'custom',
		text: 'first\nsecond',
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
