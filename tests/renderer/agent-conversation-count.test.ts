import { describe, expect, test } from 'vitest';

import {
	countOpenAgentConversations,
	toAgentConversations,
} from '../../src/renderer/lib/agents/conversation-model';
import type { ChatTabWire } from '../../src/shared/ipc/contracts/chat-tab';

/** Creates one persisted tab of any kind, with or without an agent session. */
function tab(
	id: string,
	options: {
		closedAt?: string | null;
		kind?: ChatTabWire['kind'];
		sessionId?: string | null;
	} = {},
): ChatTabWire {
	return {
		agentSessionId: options.sessionId === undefined ? id : options.sessionId,
		closedAt: options.closedAt ?? null,
		fullTitle: id,
		id,
		isPreview: false,
		kind: options.kind ?? 'chat',
		metadata: {},
		openedAt: '2026-01-01T00:00:00.000Z',
		position: 0,
		title: id,
		workspaceId: 'workspace-1',
	};
}

describe('countOpenAgentConversations', () => {
	test('counts open chats that have started a session', () => {
		expect(
			countOpenAgentConversations({
				closedTabs: [],
				openTabs: [tab('a'), tab('b')],
			}),
		).toBe(2);
	});

	test('skips a fresh chat that has no session yet and tabs that are not chats', () => {
		expect(
			countOpenAgentConversations({
				closedTabs: [],
				openTabs: [
					tab('fresh', { sessionId: null }),
					tab('file', { kind: 'file' }),
					tab('open'),
				],
			}),
		).toBe(1);
	});

	test('never counts closed conversations', () => {
		expect(
			countOpenAgentConversations({
				closedTabs: [tab('gone', { closedAt: '2026-01-02T00:00:00.000Z' })],
				openTabs: [tab('open')],
			}),
		).toBe(1);
	});

	test('agrees with the rows the Agents panel builds', () => {
		const openTabs = [
			tab('a'),
			tab('fresh', { sessionId: null }),
			tab('file', { kind: 'file' }),
			tab('b'),
		];
		const closedTabs = [
			tab('gone', { closedAt: '2026-01-02T00:00:00.000Z' }),
			tab('gone-fresh', {
				closedAt: '2026-01-02T00:00:00.000Z',
				sessionId: null,
			}),
		];

		const rows = toAgentConversations({
			blockedSessionIds: new Set(),
			catalog: undefined,
			closedTabs,
			language: 'en',
			lineageBySessionId: new Map(),
			liveBySessionId: {},
			openTabs,
			sessions: [],
		});

		expect(countOpenAgentConversations({ closedTabs, openTabs })).toBe(
			rows.filter((row) => !row.isClosed).length,
		);
	});
});
