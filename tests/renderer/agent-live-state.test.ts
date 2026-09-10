import { createStore } from 'jotai';
import { describe, expect, test } from 'vitest';

import {
	agentConversationLiveStateAtom,
	applyAgentConversationEventAtom,
	seedAgentConversationSnapshotsAtom,
} from '../../src/renderer/state/agents';
import type { AgentSessionSnapshotWire } from '../../src/shared/ipc/contracts/agent-session';

const WORKSPACE_ID = 'workspace-1';
const SESSION_ID = 'session-1';

function snapshot({
	activityOrdinal,
	branchId,
	path,
	runtimeSessionId,
}: {
	activityOrdinal: number;
	branchId: string;
	path: string;
	runtimeSessionId: string;
}): AgentSessionSnapshotWire {
	return {
		activityOrdinal,
		branchId,
		closedAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		currentTools: [{ input: { path }, name: 'read', toolCallId: 'tool-1' }],
		cwd: '/tmp/workspace-1',
		id: SESSION_ID,
		label: null,
		model: null,
		openedTabs: [],
		provider: 'pi',
		runtimeOpen: true,
		runtimeSessionId,
		status: 'streaming',
		thinkingLevel: null,
		updatedAt: '2026-01-01T00:00:00.000Z',
		workspaceId: WORKSPACE_ID,
	};
}

describe('agent conversation live state', () => {
	test('protects live events while resetting ordinals for branch and runtime replacements', () => {
		const store = createStore();
		const initial = snapshot({
			activityOrdinal: 1,
			branchId: 'branch-a',
			path: 'initial.ts',
			runtimeSessionId: 'runtime-a',
		});
		store.set(seedAgentConversationSnapshotsAtom, {
			sessions: [initial],
			workspaceId: WORKSPACE_ID,
		});
		store.set(applyAgentConversationEventAtom, {
			branchId: 'branch-a',
			envelope: {
				kind: 'message',
				payload: {
					input: { path: 'live.ts' },
					kind: 'tool-update',
					name: 'read',
					presentation: null,
					toolCallId: 'tool-1',
				},
				role: 'tool',
			},
			ordinal: 5,
			sessionId: SESSION_ID,
			workspaceId: WORKSPACE_ID,
		});
		store.set(seedAgentConversationSnapshotsAtom, {
			sessions: [{ ...initial, activityOrdinal: 4 }],
			workspaceId: WORKSPACE_ID,
		});

		expect(
			store.get(agentConversationLiveStateAtom)[WORKSPACE_ID]?.[SESSION_ID]
				?.activity.currentTools[0]?.input,
		).toEqual({ path: 'live.ts' });

		store.set(seedAgentConversationSnapshotsAtom, {
			sessions: [
				snapshot({
					activityOrdinal: 0,
					branchId: 'branch-b',
					path: 'branch.ts',
					runtimeSessionId: 'runtime-a',
				}),
			],
			workspaceId: WORKSPACE_ID,
		});
		expect(
			store.get(agentConversationLiveStateAtom)[WORKSPACE_ID]?.[SESSION_ID],
		).toMatchObject({
			branchId: 'branch-b',
			lastEventOrdinal: 0,
		});

		store.set(seedAgentConversationSnapshotsAtom, {
			sessions: [
				snapshot({
					activityOrdinal: 0,
					branchId: 'branch-b',
					path: 'runtime.ts',
					runtimeSessionId: 'runtime-b',
				}),
			],
			workspaceId: WORKSPACE_ID,
		});
		expect(
			store.get(agentConversationLiveStateAtom)[WORKSPACE_ID]?.[SESSION_ID]
				?.activity.currentTools[0]?.input,
		).toEqual({ path: 'runtime.ts' });

		store.set(applyAgentConversationEventAtom, {
			branchId: 'branch-a',
			envelope: {
				kind: 'context-usage',
				usage: { contextWindow: 1, percent: 100, tokens: 1 },
			},
			ordinal: 99,
			sessionId: SESSION_ID,
			workspaceId: WORKSPACE_ID,
		});
		expect(
			store.get(agentConversationLiveStateAtom)[WORKSPACE_ID]?.[SESSION_ID],
		).toMatchObject({ branchId: 'branch-b', contextUsage: null });
	});
});
