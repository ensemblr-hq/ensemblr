import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentAdapter } from '../../src/main/agent-runtime/agent-adapter.ts';
import type { AgentClient } from '../../src/main/agent-runtime/agent-client.ts';
import {
	AgentClientError,
	createAgentClient,
} from '../../src/main/agent-runtime/agent-client.ts';
import type {
	AgentEvent,
	AgentSessionRequest,
} from '../../src/main/agent-runtime/agent-types.ts';
import { createFakeAgentAdapter } from '../../src/main/agent-runtime/fake-agent-adapter.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';

const NOW = new Date('2026-06-08T12:00:00.000Z');

function readyExecutable(
	overrides: Partial<PiExecutableSnapshot> = {},
): PiExecutableSnapshot {
	return {
		command: '/usr/local/bin/pi',
		diagnostics: [],
		displayPath: '/usr/local/bin/pi',
		path: '/usr/local/bin/pi',
		probe: {
			args: ['--version'],
			detail: 'pi version 0.78.0',
			kind: 'version',
			status: 'success',
		},
		setting: null,
		source: 'path',
		status: 'ok',
		updatedAt: NOW.toISOString(),
		...overrides,
	};
}

function baseRequest(
	overrides: Partial<AgentSessionRequest> = {},
): AgentSessionRequest {
	return {
		agentSessionId: 'agent-session-1',
		executable: readyExecutable(),
		workspaceCwd: '/tmp/workspace',
		...overrides,
	};
}

function createClient(): {
	client: AgentClient;
	fake: ReturnType<typeof createFakeAgentAdapter>;
} {
	const fake = createFakeAgentAdapter({ now: () => NOW });
	const client = createAgentClient({
		adapter: fake.adapter,
		now: () => NOW,
	});
	return { client, fake };
}

test('seeds metadata from request and defaults to preserving PI_CODING_AGENT_DIR', async () => {
	const { client, fake } = createClient();

	const session = await client.createSession(
		baseRequest({
			env: { CUSTOM_KEY: 'value', PI_CODING_AGENT_DIR: '/custom/agent' },
			label: '  pr-review  ',
			modelOverride: 'openai/gpt-test',
		}),
	);

	const metadata = session.getMetadata();
	assert.equal(
		metadata.id,
		'agent-session-1',
		'the session is registered under the agent_sessions.id row key, not a private handle',
	);
	assert.equal(metadata.command, '/usr/local/bin/pi');
	assert.equal(metadata.cwd, '/tmp/workspace');
	assert.equal(metadata.provider, 'pi');
	assert.deepEqual(
		metadata.args,
		[],
		'argv is the adapter’s to build; the client seeds it empty',
	);
	assert.equal(metadata.label, 'pr-review');
	assert.equal(metadata.piAgentDirectoryPreserved, true);
	assert.equal(metadata.env.CUSTOM_KEY, 'value');
	assert.equal(
		Object.hasOwn(metadata.env, 'PI_CODING_AGENT_DIR'),
		false,
		'PI_CODING_AGENT_DIR must be stripped when preservePiAgentDirectory is the default true',
	);
	assert.deepEqual(metadata.model, {
		id: 'gpt-test',
		provider: 'openai',
	});
	assert.equal(metadata.status, 'starting');
	assert.equal(fake.getOpenSessions().length, 1);
});

test('normalizes the native session id onto metadata', async () => {
	const { client } = createClient();

	const session = await client.createSession(
		baseRequest({ runtimeSessionId: '  native-session-1  ' }),
	);

	assert.equal(session.getMetadata().sessionId, 'native-session-1');
});

test('treats a blank native session id as absent', async () => {
	const { client } = createClient();

	const session = await client.createSession(
		baseRequest({ runtimeSessionId: '  ' }),
	);

	assert.equal(session.getMetadata().sessionId, null);
});

test('hands the provider-neutral request to the adapter untouched', async () => {
	const { client, fake } = createClient();

	await client.createSession(
		baseRequest({
			modelOverride: 'anthropic/claude-sonnet-4',
			runtimeSessionId: 'native-2',
			thinkingLevel: 'high',
		}),
	);

	// Model, thinking, and session id are the adapter's to translate into its own
	// runtime's flags or options; the client only forwards them.
	const request = fake.getOpenSessions()[0]?.getSessionRequest();
	assert.equal(request?.modelOverride, 'anthropic/claude-sonnet-4');
	assert.equal(request?.thinkingLevel, 'high');
	assert.equal(request?.runtimeSessionId, 'native-2');
});

test('leaves model metadata null when the override is blank', async () => {
	const { client } = createClient();

	const session = await client.createSession(
		baseRequest({ modelOverride: '   ', thinkingLevel: null }),
	);

	assert.equal(session.getMetadata().model, null);
});

test('routes each request to the adapter registered for its provider', async () => {
	const pi = createFakeAgentAdapter({ now: () => NOW });
	const claude = createFakeAgentAdapter({ now: () => NOW });
	const client = createAgentClient({
		adapters: { claude: claude.adapter, pi: pi.adapter },
	});

	await client.createSession(baseRequest());
	await client.createSession(
		baseRequest({ executable: null, provider: 'claude' }),
	);

	assert.equal(pi.getOpenSessions().length, 1);
	assert.equal(claude.getOpenSessions().length, 1);
	assert.equal(claude.getOpenSessions()[0]?.getMetadata().provider, 'claude');
});

test('rejects a provider with no registered adapter', async () => {
	const { client } = createClient();

	await assert.rejects(
		() => client.createSession(baseRequest({ provider: 'claude' })),
		(error: unknown) =>
			error instanceof AgentClientError && error.code === 'adapter-failure',
	);
});

test('allows Claude to open when the caller states no executable opinion', async () => {
	const claude = createFakeAgentAdapter({ now: () => NOW });
	const client = createAgentClient({ adapters: { claude: claude.adapter } });

	const session = await client.createSession(
		baseRequest({ executable: null, provider: 'claude' }),
	);

	assert.equal(session.getMetadata().command, '');
});

test('rejects a Claude session whose resolver reported no runnable binary', async () => {
	const claude = createFakeAgentAdapter({ now: () => NOW });
	const client = createAgentClient({ adapters: { claude: claude.adapter } });

	await assert.rejects(
		() =>
			client.createSession(
				baseRequest({
					executable: { command: '', status: 'error' },
					provider: 'claude',
				}),
			),
		(error: unknown) =>
			error instanceof AgentClientError &&
			error.code === 'invalid-executable' &&
			error.message.includes('No runnable Claude Code executable'),
	);
	assert.equal(claude.getOpenSessions().length, 0);
});

test('allows an explicit PI_CODING_AGENT_DIR when the caller opts out of preservation', async () => {
	const { client } = createClient();

	const session = await client.createSession(
		baseRequest({
			env: { PI_CODING_AGENT_DIR: '/explicit/agent' },
			preservePiAgentDirectory: false,
		}),
	);

	const metadata = session.getMetadata();
	assert.equal(metadata.env.PI_CODING_AGENT_DIR, '/explicit/agent');
	assert.equal(metadata.piAgentDirectoryPreserved, false);
});

test('strips null and undefined env entries before reaching the adapter', async () => {
	const { client } = createClient();

	const session = await client.createSession(
		baseRequest({
			env: { DROPPED_NULL: null, DROPPED_UNDEFINED: undefined, KEEP: 'yes' },
		}),
	);

	const env = session.getMetadata().env;
	assert.deepEqual(Object.keys(env).sort(), ['KEEP']);
	assert.equal(env.KEEP, 'yes');
});

test('submit records the prompt and emits a user-message event with the turn id', async () => {
	const { client, fake } = createClient();
	const events: AgentEvent[] = [];

	const session = await client.createSession(baseRequest());
	session.subscribe((event) => events.push(event));

	const ack = await session.submit({ prompt: 'hello' });
	assert.match(ack.turnId, /^turn-\d+$/);

	const [controller] = fake.getOpenSessions();
	assert.equal(controller.getRequests().length, 1);
	assert.equal(controller.getRequests()[0]?.prompt, 'hello');

	const messageEvent = events.find((event) => event.type === 'message');
	assert.ok(messageEvent);
	assert.equal(messageEvent.role, 'user');
	assert.equal(messageEvent.turnId, ack.turnId);
});

test('submit rejects empty prompts at the client boundary', async () => {
	const { client } = createClient();
	const session = await client.createSession(baseRequest());

	await assert.rejects(
		() => session.submit({ prompt: '   ' }),
		(error: unknown) =>
			error instanceof AgentClientError && error.code === 'submit-failed',
	);
});

test('status changes propagate as discrete events with previous status', async () => {
	const { client, fake } = createClient();
	const events: AgentEvent[] = [];

	const session = await client.createSession(baseRequest());
	session.subscribe((event) => events.push(event));

	const [controller] = fake.getOpenSessions();
	controller.setStatus('idle');
	controller.setStatus('streaming');

	const statusEvents = events.filter((event) => event.type === 'status');
	assert.equal(statusEvents.length, 2);
	assert.equal(statusEvents[0]?.previous, 'starting');
	assert.equal(statusEvents[0]?.status, 'idle');
	assert.equal(statusEvents[1]?.previous, 'idle');
	assert.equal(statusEvents[1]?.status, 'streaming');
	assert.equal(session.getMetadata().status, 'streaming');
});

test('abort closes the session, emits a shutdown event, and rejects further submits', async () => {
	const { client, fake } = createClient();
	const events: AgentEvent[] = [];

	const session = await client.createSession(baseRequest());
	session.subscribe((event) => events.push(event));

	await session.abort('user-cancelled');

	const shutdown = events.find((event) => event.type === 'shutdown');
	assert.ok(shutdown);
	assert.equal(shutdown.reason, 'aborted');
	assert.equal(fake.getOpenSessions().length, 0);

	await assert.rejects(
		() => session.submit({ prompt: 'still here?' }),
		(error: unknown) =>
			error instanceof AgentClientError && error.code === 'session-closed',
	);
});

test('close is idempotent and unregisters the session exactly once', async () => {
	const { client, fake } = createClient();

	const session = await client.createSession(baseRequest());
	await session.close();
	await session.close();

	assert.equal(client.listSessions().length, 0);
	assert.equal(fake.getOpenSessions().length, 0);
});

test('shutdown closes every open session and propagates to the adapter', async () => {
	const { client, fake } = createClient();

	await client.createSession(baseRequest());
	await client.createSession(
		baseRequest({
			agentSessionId: 'agent-session-2',
			workspaceCwd: '/tmp/other',
		}),
	);

	await client.shutdown();

	assert.equal(client.listSessions().length, 0);
	assert.equal(fake.getOpenSessions().length, 0);
	assert.equal(fake.getShutdownCount(), 1);
});

test('rejects sessions when the executable is not ready', async () => {
	const { client } = createClient();

	await assert.rejects(
		() =>
			client.createSession(
				baseRequest({
					executable: readyExecutable({ command: '', status: 'error' }),
				}),
			),
		(error: unknown) =>
			error instanceof AgentClientError && error.code === 'invalid-executable',
	);
});

test('rejects sessions when no workspace cwd is supplied', async () => {
	const { client } = createClient();

	await assert.rejects(
		() => client.createSession(baseRequest({ workspaceCwd: '   ' })),
		(error: unknown) =>
			error instanceof AgentClientError && error.code === 'invalid-cwd',
	);
});

test('unsubscribed listeners stop receiving events', async () => {
	const { client, fake } = createClient();
	const captured: AgentEvent[] = [];

	const session = await client.createSession(baseRequest());
	const subscription = session.subscribe((event) => captured.push(event));

	const [controller] = fake.getOpenSessions();
	controller.setStatus('idle');
	subscription.unsubscribe();
	controller.setStatus('streaming');

	const statuses = captured
		.filter((event) => event.type === 'status')
		.map((event) => event.status);
	assert.deepEqual(statuses, ['idle']);
	// One listener remains: the client wrapper's internal shutdown watcher, which
	// removes the session from the map and flips it closed when the child exits on
	// its own. It unsubscribes on shutdown, not on user unsubscribe.
	assert.equal(controller.listenerCount(), 1);
});

test('metadata events flow from controller into subscribers', async () => {
	const { client, fake } = createClient();
	const events: AgentEvent[] = [];

	const session = await client.createSession(baseRequest());
	session.subscribe((event) => events.push(event));

	const [controller] = fake.getOpenSessions();
	controller.setSessionId('runtime-abc');
	controller.emit({
		at: NOW.toISOString(),
		metadata: session.getMetadata(),
		type: 'metadata',
	});

	const metadataEvent = events.find((event) => event.type === 'metadata');
	assert.ok(metadataEvent);
	assert.equal(metadataEvent.metadata.sessionId, 'runtime-abc');
});

test('model override without a provider segment falls back to "override"', async () => {
	const { client } = createClient();

	const session = await client.createSession(
		baseRequest({ modelOverride: 'gpt-only' }),
	);

	assert.deepEqual(session.getMetadata().model, {
		id: 'gpt-only',
		provider: 'override',
	});
});

test('adapter createSession rejection is rewrapped as adapter-failure', async () => {
	const failingAdapter: AgentAdapter = {
		createSession: async () => {
			throw new Error('spawn ENOENT');
		},
		shutdown: async () => undefined,
	};

	const client = createAgentClient({
		adapter: failingAdapter,
		now: () => NOW,
	});

	await assert.rejects(
		() => client.createSession(baseRequest()),
		(error: unknown) =>
			error instanceof AgentClientError &&
			error.code === 'adapter-failure' &&
			error.recoverable === true &&
			error.detail === 'spawn ENOENT',
	);
});

test('subscribe on a closed session raises session-closed', async () => {
	const { client } = createClient();

	const session = await client.createSession(baseRequest());
	await session.close();

	assert.throws(
		() => session.subscribe(() => undefined),
		(error: unknown) =>
			error instanceof AgentClientError && error.code === 'session-closed',
	);
});

test('a throwing listener does not block the rest of the fan-out', async () => {
	const { client, fake } = createClient();
	const captured: AgentEvent[] = [];

	const session = await client.createSession(baseRequest());
	session.subscribe(() => {
		throw new Error('listener exploded');
	});
	session.subscribe((event) => captured.push(event));

	const [controller] = fake.getOpenSessions();
	controller.setStatus('idle');

	const statuses = captured
		.filter((event) => event.type === 'status')
		.map((event) => event.status);
	assert.deepEqual(statuses, ['idle']);
});
