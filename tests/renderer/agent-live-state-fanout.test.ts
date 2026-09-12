/**
 * Every applied agent session event used to replace the whole cross-workspace
 * live-state object, and the workspace shell subscribed to it unconditionally —
 * so a busy turn re-rendered the root of the workspace UI tens of times a
 * second, including for events that moved nothing and for events belonging to
 * another workspace entirely.
 */

import { createStore } from 'jotai';
import { describe, expect, test } from 'vitest';

import {
	agentConversationLiveStateAtom,
	agentWorkspaceLiveStateAtomFamily,
	applyAgentConversationEventAtom,
	seedAgentConversationSnapshotsAtom,
} from '../../src/renderer/state/agents';
import type {
	AgentPersistedEnvelope,
	AgentSessionSnapshotWire,
} from '../../src/shared/ipc/contracts/agent-session';

const SESSION_ID = 'session-1';

function snapshot(workspaceId: string): AgentSessionSnapshotWire {
	return {
		activityOrdinal: 0,
		branchId: 'branch-a',
		closedAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		currentTools: [],
		cwd: `/tmp/${workspaceId}`,
		id: SESSION_ID,
		label: null,
		model: null,
		openedTabs: [],
		provider: 'pi',
		runtimeOpen: true,
		runtimeSessionId: 'runtime-a',
		status: 'streaming',
		thinkingLevel: null,
		updatedAt: '2026-01-01T00:00:00.000Z',
		workspaceId,
	};
}

function seed(store: ReturnType<typeof createStore>, workspaceId: string) {
	store.set(seedAgentConversationSnapshotsAtom, {
		sessions: [snapshot(workspaceId)],
		workspaceId,
	});
}

function apply(
	store: ReturnType<typeof createStore>,
	workspaceId: string,
	envelope: AgentPersistedEnvelope,
	ordinal: number,
) {
	store.set(applyAgentConversationEventAtom, {
		branchId: 'branch-a',
		envelope,
		ordinal,
		sessionId: SESSION_ID,
		workspaceId,
	});
}

/** An assistant message carrying no tool lifecycle — activity ignores it. */
const PROSE: AgentPersistedEnvelope = {
	kind: 'message',
	payload: {
		kind: 'message',
		parts: [{ kind: 'text', text: 'thinking out loud' }],
		role: 'assistant',
	},
	role: 'agent',
};

/** A tool start, which does move the activity projection. */
const TOOL_CALL: AgentPersistedEnvelope = {
	kind: 'message',
	payload: {
		input: { path: 'a.ts' },
		kind: 'tool-call',
		name: 'read',
		toolCallId: 'tool-1',
	},
	role: 'tool',
} as AgentPersistedEnvelope;

describe('applyAgentConversationEventAtom', () => {
	test('writes nothing when an event moves no observable state', () => {
		const store = createStore();
		seed(store, 'w1');
		const before = store.get(agentConversationLiveStateAtom);

		apply(store, 'w1', PROSE, 10);
		apply(store, 'w1', PROSE, 11);

		expect(store.get(agentConversationLiveStateAtom)).toBe(before);
	});

	test('still writes when the event moves activity', () => {
		const store = createStore();
		seed(store, 'w1');
		const before = store.get(agentConversationLiveStateAtom);

		apply(store, 'w1', TOOL_CALL, 10);

		expect(store.get(agentConversationLiveStateAtom)).not.toBe(before);
		expect(
			store.get(agentConversationLiveStateAtom).w1?.[SESSION_ID]
				?.lastEventOrdinal,
		).toBe(10);
	});

	test('still writes when only the context usage moves', () => {
		const store = createStore();
		seed(store, 'w1');
		const before = store.get(agentConversationLiveStateAtom);

		apply(
			store,
			'w1',
			{
				kind: 'context-usage',
				usage: { contextWindow: 200_000, percent: 12, tokens: 24_000 },
			} as AgentPersistedEnvelope,
			10,
		);

		expect(store.get(agentConversationLiveStateAtom)).not.toBe(before);
	});
});

describe('agentWorkspaceLiveStateAtomFamily', () => {
	test('keeps its value when another workspace is written', () => {
		const store = createStore();
		seed(store, 'w1');
		seed(store, 'w2');
		const slice = agentWorkspaceLiveStateAtomFamily('w1');
		const before = store.get(slice);

		const wholeMapBefore = store.get(agentConversationLiveStateAtom);
		apply(store, 'w2', TOOL_CALL, 10);

		expect(store.get(agentConversationLiveStateAtom)).not.toBe(wholeMapBefore);
		expect(store.get(slice)).toBe(before);
	});

	test('changes when its own workspace is written', () => {
		const store = createStore();
		seed(store, 'w1');
		const slice = agentWorkspaceLiveStateAtomFamily('w1');
		const before = store.get(slice);

		apply(store, 'w1', TOOL_CALL, 10);

		expect(store.get(slice)).not.toBe(before);
	});

	test('answers a workspace nothing has been seeded for', () => {
		const store = createStore();

		expect(store.get(agentWorkspaceLiveStateAtomFamily('unseeded'))).toEqual(
			{},
		);
	});

	test('returns the same atom for the same workspace id', () => {
		expect(agentWorkspaceLiveStateAtomFamily('w1')).toBe(
			agentWorkspaceLiveStateAtomFamily('w1'),
		);
	});
});
