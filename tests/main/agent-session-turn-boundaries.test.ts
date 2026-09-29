/// <reference types="node" />

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentAdapter } from '../../src/main/agent-runtime/agent-adapter.ts';
import { createAgentClient } from '../../src/main/agent-runtime/agent-client.ts';
import { createAgentSessionService } from '../../src/main/agent-runtime/agent-session-service.ts';
import { AgentSessionServiceError } from '../../src/main/agent-runtime/agent-session-service-error.ts';
import { AgentSubmitError } from '../../src/main/agent-runtime/agent-types.ts';
import { createFakeAgentAdapter } from '../../src/main/agent-runtime/fake-agent-adapter.ts';
import type { TurnCheckpointPort } from '../../src/main/checkpoints/index.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import { listEventsByBranch } from '../../src/main/storage/repositories/agent-event-repository.ts';
import {
	getAgentSessionById,
	listTurns,
} from '../../src/main/storage/repositories/agent-session-repository.ts';
import type { CheckpointRow } from '../../src/main/storage/repositories/index.ts';

type PortCall =
	| { closingTurnId: string | null; op: 'open'; turnId: string }
	| { op: 'discard' | 'end' | 'reopen'; turnId: string }
	| { atCommit: string; op: 'endAt'; turnId: string }
	| { op: 'drain' };

interface Gate {
	entered: Promise<void>;
	release: () => void;
}

const WORKSPACE_CWD = '/tmp/ensemblr/turns/ws';

function openFixture(t: import('node:test').TestContext): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-turn-bounds-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'turn-boundaries.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});
	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-turns', 'turns', 'Turns', '/tmp/ensemblr/turns', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-turns', 'repo-turns', 'turns', 'Turns', '${WORKSPACE_CWD}');
`);
	return connection.database;
}

function createReadyExecutable(): PiExecutableSnapshot {
	return {
		command: '/usr/local/bin/pi',
		diagnostics: [],
		displayPath: '/usr/local/bin/pi',
		path: '/usr/local/bin/pi',
		probe: null,
		setting: null,
		source: null,
		status: 'ok',
		updatedAt: '2026-09-29T00:00:00.000Z',
	};
}

function createGate(): Gate & { pass: () => Promise<void> } {
	let enter: () => void = () => undefined;
	let release: () => void = () => undefined;
	const entered = new Promise<void>((resolve) => {
		enter = resolve;
	});
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	return {
		entered,
		pass: () => {
			enter();
			return released;
		},
		release,
	};
}

// The port records every call; `holdNextOpen` and `holdDrain` park the next
// such call until the test releases it, standing in for a slow git capture.
function createRecordingPort() {
	const calls: PortCall[] = [];
	let heldOpen: ReturnType<typeof createGate> | null = null;
	let heldDrain: ReturnType<typeof createGate> | null = null;
	const port: TurnCheckpointPort = {
		discardTurn: async ({ turnId }) => {
			calls.push({ op: 'discard', turnId });
		},
		drain: async () => {
			calls.push({ op: 'drain' });
			const gate = heldDrain;
			heldDrain = null;
			await gate?.pass();
		},
		endTurn: async ({ turnId }) => {
			calls.push({ op: 'end', turnId });
		},
		endTurnAt: async ({ commitHash, turnId }) => {
			calls.push({ atCommit: commitHash, op: 'endAt', turnId });
		},
		flushSession: async () => undefined,
		openTurn: async ({ closingTurnId, turnId }) => {
			calls.push({ closingTurnId, op: 'open', turnId });
			const gate = heldOpen;
			heldOpen = null;
			await gate?.pass();
			return {
				gitHash: `commit-${turnId}`,
				gitRef: `ref-${turnId}`,
			} as CheckpointRow;
		},
		reopenTurn: async ({ turnId }) => {
			calls.push({ op: 'reopen', turnId });
		},
	};
	return {
		calls,
		holdDrain: (): Gate => {
			heldDrain = createGate();
			return heldDrain;
		},
		holdNextOpen: (): Gate => {
			heldOpen = createGate();
			return heldOpen;
		},
		port,
	};
}

// A runtime fails the submits `fails` selects with `failure`, e.g. a steer it
// cannot deliver once the turn it targeted has already wound down.
function failSubmits(
	adapter: AgentAdapter,
	fails: (request: { prompt: string; streamingBehavior?: unknown }) => boolean,
	failure: () => Error,
): AgentAdapter {
	return {
		createSession: async (input) => {
			const session = await adapter.createSession(input);
			return {
				...session,
				submit: async (request) => {
					if (fails(request)) {
						throw failure();
					}
					return session.submit(request);
				},
			};
		},
		shutdown: adapter.shutdown,
	};
}

function rejectInterjections(adapter: AgentAdapter): AgentAdapter {
	return failSubmits(
		adapter,
		(request) => Boolean(request.streamingBehavior),
		() => new Error('steer rejected'),
	);
}

function isSessionNotOpen(error: unknown): boolean {
	return (
		error instanceof AgentSessionServiceError &&
		error.code === 'session-not-open'
	);
}

// Aborting settles the runtime to `idle` before its child exits, so the turn is
// settled as completed by the time the stop stamps it.
function idleBeforeAbort(
	adapter: AgentAdapter,
	goIdle: () => void,
): AgentAdapter {
	return {
		createSession: async (input) => {
			const session = await adapter.createSession(input);
			return {
				...session,
				abort: async (reason) => {
					goIdle();
					await session.abort(reason);
				},
			};
		},
		shutdown: adapter.shutdown,
	};
}

async function openService(
	t: import('node:test').TestContext,
	wrapAdapter: (
		adapter: AgentAdapter,
		fake: ReturnType<typeof createFakeAgentAdapter>,
	) => AgentAdapter = (adapter) => adapter,
) {
	const database = openFixture(t);
	const fake = createFakeAgentAdapter();
	const recording = createRecordingPort();
	const service = createAgentSessionService({
		agentClient: createAgentClient({
			adapter: wrapAdapter(fake.adapter, fake),
		}),
		databaseService: {
			close: () => undefined,
			getConnection: () => ({ database, path: ':memory:', schemaVersion: 5 }),
			getHealth: () => ({ path: ':memory:', schemaVersion: 5, status: 'ok' }),
			open: () => ({ path: ':memory:', schemaVersion: 5, status: 'ok' }),
			vacuum: () => undefined,
		},
		queueNaming: () => undefined,
		turnCheckpoints: recording.port,
	});
	const snapshot = await service.openSession({
		executable: createReadyExecutable(),
		workspaceCwd: WORKSPACE_CWD,
		workspaceId: 'ws-turns',
	});
	const runtime = () => {
		const [open] = fake.getOpenSessions();
		assert.ok(open, 'expected one open runtime session');
		return open;
	};
	const turns = () => listTurns({ branchId: snapshot.branchId, database });
	const emitAgentText = (text: string) =>
		runtime().emit({
			at: new Date().toISOString(),
			payload: { kind: 'text', text },
			role: 'agent',
			turnId: 'runtime-turn',
			type: 'message',
		});
	const turnOfAgentText = (text: string) =>
		listEventsByBranch({ branchId: snapshot.branchId, database }).find(
			(event) =>
				event.payload?.kind === 'message' &&
				event.payload.payload.kind === 'text' &&
				event.payload.payload.text === text,
		)?.turnId;
	return {
		calls: recording.calls,
		database,
		holdDrain: recording.holdDrain,
		holdNextOpen: recording.holdNextOpen,
		emitAgentText,
		fake,
		runtime,
		service,
		snapshot,
		turnOfAgentText,
		turns,
	};
}

test('a prompt opens its turn with nothing to close', async (t) => {
	const harness = await openService(t);

	await harness.service.submitPrompt({
		prompt: 'first',
		sessionId: harness.snapshot.id,
	});

	const [turn] = harness.turns();
	assert.equal(turn?.status, 'submitted');
	assert.deepEqual(harness.calls, [
		{ closingTurnId: null, op: 'open', turnId: turn?.id },
	]);
});

test('idle settles the active turn and locks its range', async (t) => {
	const harness = await openService(t);
	await harness.service.submitPrompt({
		prompt: 'first',
		sessionId: harness.snapshot.id,
	});

	harness.runtime().setStatus('idle');

	const [turn] = harness.turns();
	assert.equal(turn?.status, 'completed');
	assert.ok(turn?.completedAt, 'a settled turn carries its end instant');
	assert.deepEqual(harness.calls.at(-1), { op: 'end', turnId: turn?.id });
});

test('streaming again after idle reopens the settled turn', async (t) => {
	const harness = await openService(t);
	await harness.service.submitPrompt({
		prompt: 'first',
		sessionId: harness.snapshot.id,
	});
	harness.runtime().setStatus('idle');

	harness.runtime().setStatus('streaming');

	const [turn] = harness.turns();
	assert.equal(turn?.status, 'submitted');
	assert.equal(turn?.completedAt, null);
	assert.deepEqual(
		harness.calls.map((call) => call.op),
		['open', 'end', 'reopen'],
	);
	assert.deepEqual(harness.calls.at(-1), { op: 'reopen', turnId: turn?.id });

	harness.runtime().setStatus('idle');
	assert.equal(harness.turns()[0]?.status, 'completed');
	assert.deepEqual(harness.calls.at(-1), { op: 'end', turnId: turn?.id });
});

test('a steer opens a new turn, closes the one it interrupts, and takes later events', async (t) => {
	const harness = await openService(t);
	await harness.service.submitPrompt({
		prompt: 'first',
		sessionId: harness.snapshot.id,
	});
	harness.emitAgentText('before steer');

	await harness.service.submitPrompt({
		prompt: 'change course',
		sessionId: harness.snapshot.id,
		streamingBehavior: 'steer',
	});
	harness.emitAgentText('after steer');

	const [first, steer] = harness.turns();
	assert.equal(first?.status, 'completed');
	assert.ok(first?.completedAt, 'the interrupted turn ends at the steer');
	assert.equal(steer?.status, 'submitted');
	assert.equal(steer?.promptText, 'change course');
	// The steer opens its turn closing nothing, and the interrupted turn is
	// ended at that snapshot only once the switch has landed.
	assert.deepEqual(harness.calls.slice(-2), [
		{ closingTurnId: null, op: 'open', turnId: steer?.id },
		{ atCommit: `commit-${steer?.id}`, op: 'endAt', turnId: first?.id },
	]);
	assert.equal(harness.turnOfAgentText('before steer'), first?.id);
	assert.equal(harness.turnOfAgentText('after steer'), steer?.id);
	assert.equal(
		getAgentSessionById({ database: harness.database, id: harness.snapshot.id })
			?.status,
		'streaming',
		'a steer leaves the session streaming',
	);

	harness.runtime().setStatus('idle');
	assert.equal(harness.turns()[0]?.completedAt, first?.completedAt);
	assert.equal(harness.turns()[1]?.status, 'completed');
	assert.deepEqual(harness.calls.at(-1), { op: 'end', turnId: steer?.id });
});

test('a follow-up after the turn settled closes nothing', async (t) => {
	const harness = await openService(t);
	await harness.service.submitPrompt({
		prompt: 'first',
		sessionId: harness.snapshot.id,
	});
	harness.runtime().setStatus('idle');

	await harness.service.submitPrompt({
		prompt: 'and another thing',
		sessionId: harness.snapshot.id,
		streamingBehavior: 'followUp',
	});

	const [, followUp] = harness.turns();
	assert.deepEqual(harness.calls.at(-1), {
		closingTurnId: null,
		op: 'open',
		turnId: followUp?.id,
	});
});

test('a rejected steer hands the interrupted turn back', async (t) => {
	const harness = await openService(t, rejectInterjections);
	await harness.service.submitPrompt({
		prompt: 'first',
		sessionId: harness.snapshot.id,
	});

	await assert.rejects(
		harness.service.submitPrompt({
			prompt: 'change course',
			sessionId: harness.snapshot.id,
			streamingBehavior: 'steer',
		}),
		/steer rejected/,
	);
	harness.emitAgentText('still the first turn');

	const [first, steer] = harness.turns();
	assert.equal(first?.status, 'submitted');
	assert.equal(first?.completedAt, null);
	assert.equal(steer?.status, 'errored');
	assert.ok(steer?.completedAt);
	assert.deepEqual(harness.calls.slice(-2), [
		{ op: 'discard', turnId: steer?.id },
		{ op: 'reopen', turnId: first?.id },
	]);
	assert.equal(harness.turnOfAgentText('still the first turn'), first?.id);
	assert.equal(
		getAgentSessionById({ database: harness.database, id: harness.snapshot.id })
			?.status,
		'streaming',
	);
});

test('stopping a running turn aborts it and locks its range once', async (t) => {
	const harness = await openService(t);
	await harness.service.submitPrompt({
		prompt: 'first',
		sessionId: harness.snapshot.id,
	});

	await harness.service.stopSession({ sessionId: harness.snapshot.id });

	const [turn] = harness.turns();
	assert.equal(turn?.status, 'aborted');
	assert.ok(turn?.completedAt);
	assert.deepEqual(
		harness.calls.filter((call) => call.op === 'end'),
		[{ op: 'end', turnId: turn?.id }],
	);
});

test('stopping after the turn settled leaves its end where it was', async (t) => {
	const harness = await openService(t);
	await harness.service.submitPrompt({
		prompt: 'first',
		sessionId: harness.snapshot.id,
	});
	harness.runtime().setStatus('idle');
	const settledAt = harness.turns()[0]?.completedAt;
	await delay(5);

	await harness.service.stopSession({ sessionId: harness.snapshot.id });

	const [turn] = harness.turns();
	assert.equal(turn?.status, 'completed');
	assert.equal(turn?.completedAt, settledAt);
	assert.equal(harness.calls.filter((call) => call.op === 'end').length, 1);
});

test('a stop still records an abort when the runtime idles on its way out', async (t) => {
	const harness = await openService(t, (adapter, fake) =>
		idleBeforeAbort(adapter, () =>
			fake.getOpenSessions()[0]?.setStatus('idle'),
		),
	);
	await harness.service.submitPrompt({
		prompt: 'first',
		sessionId: harness.snapshot.id,
	});

	await harness.service.stopSession({ sessionId: harness.snapshot.id });

	const [turn] = harness.turns();
	assert.equal(turn?.status, 'aborted');
	assert.ok(turn?.completedAt);
	assert.equal(harness.calls.filter((call) => call.op === 'end').length, 1);
});

test('a new prompt closes a turn that is still open', async (t) => {
	const harness = await openService(t);
	await harness.service.submitPrompt({
		prompt: 'first',
		sessionId: harness.snapshot.id,
	});

	await harness.service.submitPrompt({
		prompt: 'second',
		sessionId: harness.snapshot.id,
	});

	const [first, second] = harness.turns();
	assert.equal(first?.status, 'completed');
	assert.ok(first?.completedAt);
	assert.deepEqual(harness.calls.at(-1), {
		closingTurnId: first?.id,
		op: 'open',
		turnId: second?.id,
	});
});

test('events streamed while a steer is captured keep the interrupted turn', async (t) => {
	const harness = await openService(t);
	await harness.service.submitPrompt({
		prompt: 'first',
		sessionId: harness.snapshot.id,
	});
	const capture = harness.holdNextOpen();

	const steering = harness.service.submitPrompt({
		prompt: 'change course',
		sessionId: harness.snapshot.id,
		streamingBehavior: 'steer',
	});
	await capture.entered;
	harness.emitAgentText('during capture');

	const [firstDuring, steerDuring] = harness.turns();
	assert.equal(firstDuring?.status, 'submitted', 'still open mid-capture');
	assert.equal(firstDuring?.completedAt, null);
	assert.equal(steerDuring?.status, 'submitted');

	capture.release();
	await steering;
	harness.emitAgentText('after steer');

	const [first, steer] = harness.turns();
	assert.equal(harness.turnOfAgentText('during capture'), first?.id);
	assert.equal(harness.turnOfAgentText('after steer'), steer?.id);
	assert.equal(first?.status, 'completed');
	assert.ok(first?.completedAt);
});

test('two steers in quick succession each close the one before', async (t) => {
	const harness = await openService(t);
	await harness.service.submitPrompt({
		prompt: 'first',
		sessionId: harness.snapshot.id,
	});
	const capture = harness.holdNextOpen();

	const firstSteer = harness.service.submitPrompt({
		prompt: 'steer one',
		sessionId: harness.snapshot.id,
		streamingBehavior: 'steer',
	});
	await capture.entered;
	const secondSteer = harness.service.submitPrompt({
		prompt: 'steer two',
		sessionId: harness.snapshot.id,
		streamingBehavior: 'steer',
	});
	capture.release();
	await Promise.all([firstSteer, secondSteer]);

	const [first, one, two] = harness.turns();
	assert.deepEqual(
		harness.calls
			.filter((call) => call.op === 'open' || call.op === 'endAt')
			.slice(-4),
		[
			{ closingTurnId: null, op: 'open', turnId: one?.id },
			{ atCommit: `commit-${one?.id}`, op: 'endAt', turnId: first?.id },
			{ closingTurnId: null, op: 'open', turnId: two?.id },
			{ atCommit: `commit-${two?.id}`, op: 'endAt', turnId: one?.id },
		],
	);
	assert.equal(one?.status, 'completed');
	assert.equal(two?.status, 'submitted');
});

test('an unconfirmed steer keeps its turn, since the runtime may have taken it', async (t) => {
	const harness = await openService(t, (adapter) =>
		failSubmits(
			adapter,
			(request) => Boolean(request.streamingBehavior),
			() => new AgentSubmitError('steer unconfirmed', 'unconfirmed'),
		),
	);
	await harness.service.submitPrompt({
		prompt: 'first',
		sessionId: harness.snapshot.id,
	});

	await assert.rejects(
		harness.service.submitPrompt({
			prompt: 'change course',
			sessionId: harness.snapshot.id,
			streamingBehavior: 'steer',
		}),
		/steer unconfirmed/,
	);
	harness.emitAgentText('after steer');

	const [first, steer] = harness.turns();
	assert.equal(first?.status, 'completed');
	assert.equal(steer?.status, 'submitted');
	assert.equal(steer?.completedAt, null);
	assert.equal(harness.turnOfAgentText('after steer'), steer?.id);
	assert.ok(!harness.calls.some((call) => call.op === 'discard'));
});

test('a refused prompt discards its checkpoint and hands the open turn back', async (t) => {
	const harness = await openService(t, (adapter) =>
		failSubmits(
			adapter,
			(request) => request.prompt === 'second',
			() => new AgentSubmitError('prompt refused', 'rejected'),
		),
	);
	await harness.service.submitPrompt({
		prompt: 'first',
		sessionId: harness.snapshot.id,
	});

	await assert.rejects(
		harness.service.submitPrompt({
			prompt: 'second',
			sessionId: harness.snapshot.id,
		}),
		/prompt refused/,
	);

	const [first, second] = harness.turns();
	assert.equal(first?.status, 'submitted');
	assert.equal(second?.status, 'errored');
	assert.deepEqual(harness.calls.slice(-2), [
		{ op: 'discard', turnId: second?.id },
		{ op: 'reopen', turnId: first?.id },
	]);
});

test('a stop during a steer capture refuses the steer and discards its turn', async (t) => {
	const harness = await openService(t);
	await harness.service.submitPrompt({
		prompt: 'first',
		sessionId: harness.snapshot.id,
	});
	const capture = harness.holdNextOpen();

	const steering = harness.service.submitPrompt({
		prompt: 'change course',
		sessionId: harness.snapshot.id,
		streamingBehavior: 'steer',
	});
	await capture.entered;
	await harness.service.stopSession({ sessionId: harness.snapshot.id });
	capture.release();

	await assert.rejects(steering, isSessionNotOpen);
	const [first, steer] = harness.turns();
	assert.equal(first?.status, 'aborted');
	assert.equal(steer?.status, 'errored');
	assert.deepEqual(harness.calls.at(-1), { op: 'discard', turnId: steer?.id });
});

test('shutdown waits for every queued checkpoint write', async (t) => {
	const harness = await openService(t);
	await harness.service.submitPrompt({
		prompt: 'first',
		sessionId: harness.snapshot.id,
	});
	const drain = harness.holdDrain();
	let finished = false;

	const shutdown = harness.service.shutdown().then(() => {
		finished = true;
	});
	await drain.entered;
	await delay(5);

	assert.equal(finished, false, 'shutdown is still waiting on the drain');
	assert.deepEqual(harness.calls.at(-1), { op: 'drain' });
	drain.release();
	await shutdown;
	assert.equal(finished, true);
});
