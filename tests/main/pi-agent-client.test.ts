import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakePiAgentAdapter } from '../../src/main/pi-agent/fake-pi-agent-client.ts';
import type { PiAgentAdapter } from '../../src/main/pi-agent/pi-agent-adapter.ts';
import type { PiAgentClient } from '../../src/main/pi-agent/pi-agent-client.ts';
import {
	createPiAgentClient,
	PiAgentClientError,
} from '../../src/main/pi-agent/pi-agent-client.ts';
import type {
	PiAgentEvent,
	PiAgentSessionRequest,
} from '../../src/main/pi-agent/pi-agent-types.ts';
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
	overrides: Partial<PiAgentSessionRequest> = {},
): PiAgentSessionRequest {
	return {
		executable: readyExecutable(),
		workspaceCwd: '/tmp/workspace',
		...overrides,
	};
}

function createClient(): {
	client: PiAgentClient;
	fake: ReturnType<typeof createFakePiAgentAdapter>;
} {
	const fake = createFakePiAgentAdapter({ now: () => NOW });
	const client = createPiAgentClient({
		adapter: fake.adapter,
		now: () => NOW,
		uuid: (() => {
			let counter = 0;
			return () => `session-${++counter}`;
		})(),
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
	assert.equal(metadata.id, 'session-1');
	assert.equal(metadata.command, '/usr/local/bin/pi');
	assert.equal(metadata.cwd, '/tmp/workspace');
	assert.deepEqual(metadata.args, [
		'--mode',
		'rpc',
		'--model',
		'openai/gpt-test',
	]);
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

test('adds native Pi session id args when supplied', async () => {
	const { client } = createClient();

	const session = await client.createSession(
		baseRequest({ piSessionId: 'native-session-1' }),
	);

	const metadata = session.getMetadata();
	assert.deepEqual(metadata.args, [
		'--mode',
		'rpc',
		'--session-id',
		'native-session-1',
	]);
	assert.equal(metadata.sessionId, 'native-session-1');
});

test('threads model and thinking selection into the spawn args', async () => {
	const { client } = createClient();

	const session = await client.createSession(
		baseRequest({
			modelOverride: 'anthropic/claude-sonnet-4',
			piSessionId: 'native-2',
			thinkingLevel: 'high',
		}),
	);

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
});

test('omits model and thinking flags when the request leaves them unset', async () => {
	const { client } = createClient();

	const session = await client.createSession(
		baseRequest({ modelOverride: '   ', thinkingLevel: null }),
	);

	assert.deepEqual(session.getMetadata().args, ['--mode', 'rpc']);
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
	const events: PiAgentEvent[] = [];

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
			error instanceof PiAgentClientError && error.code === 'submit-failed',
	);
});

test('status changes propagate as discrete events with previous status', async () => {
	const { client, fake } = createClient();
	const events: PiAgentEvent[] = [];

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
	const events: PiAgentEvent[] = [];

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
			error instanceof PiAgentClientError && error.code === 'session-closed',
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
	await client.createSession(baseRequest({ workspaceCwd: '/tmp/other' }));

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
			error instanceof PiAgentClientError &&
			error.code === 'invalid-executable',
	);
});

test('rejects sessions when no workspace cwd is supplied', async () => {
	const { client } = createClient();

	await assert.rejects(
		() => client.createSession(baseRequest({ workspaceCwd: '   ' })),
		(error: unknown) =>
			error instanceof PiAgentClientError && error.code === 'invalid-cwd',
	);
});

test('unsubscribed listeners stop receiving events', async () => {
	const { client, fake } = createClient();
	const captured: PiAgentEvent[] = [];

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
	const events: PiAgentEvent[] = [];

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
	const failingAdapter: PiAgentAdapter = {
		createSession: async () => {
			throw new Error('spawn ENOENT');
		},
		shutdown: async () => undefined,
	};

	const client = createPiAgentClient({
		adapter: failingAdapter,
		now: () => NOW,
		uuid: () => 'session-x',
	});

	await assert.rejects(
		() => client.createSession(baseRequest()),
		(error: unknown) =>
			error instanceof PiAgentClientError &&
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
			error instanceof PiAgentClientError && error.code === 'session-closed',
	);
});

test('a throwing listener does not block the rest of the fan-out', async () => {
	const { client, fake } = createClient();
	const captured: PiAgentEvent[] = [];

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
