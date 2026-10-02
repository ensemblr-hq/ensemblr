import { describe, expect, test } from 'vitest';

import { ActiveChatStore } from '../../src/main/agent-runtime/active-chat-store';

/** Names a chat the notifier is asking the store about. */
function ask(
	agentSessionId: string,
	chatTabId: string | null = null,
	workspaceId = 'w1',
) {
	return { agentSessionId, chatTabId, workspaceId };
}

describe('ActiveChatStore', () => {
	test('reports nothing on screen until the renderer reports a chat', () => {
		const store = new ActiveChatStore();
		expect(store.isOnScreen(ask('s1', 'tab-1'))).toBe(false);
	});

	test('matches the reported chat by its session id', () => {
		const store = new ActiveChatStore();
		store.apply({
			agentSessionId: 's1',
			chatTabId: 'tab-1',
			workspaceId: 'w1',
		});
		expect(store.isOnScreen(ask('s1', 'tab-1'))).toBe(true);
	});

	test('matches by tab id while the reported session id is still null', () => {
		const store = new ActiveChatStore();
		store.apply({
			agentSessionId: null,
			chatTabId: 'tab-1',
			workspaceId: 'w1',
		});
		expect(store.isOnScreen(ask('s1', 'tab-1'))).toBe(true);
	});

	test('matches by tab id when the reported session id has gone stale', () => {
		const store = new ActiveChatStore();
		store.apply({
			agentSessionId: 'session-the-tab-list-still-thinks-is-running',
			chatTabId: 'tab-1',
			workspaceId: 'w1',
		});
		expect(store.isOnScreen(ask('s1', 'tab-1'))).toBe(true);
	});

	test('does not match another chat in the same workspace', () => {
		const store = new ActiveChatStore();
		store.apply({
			agentSessionId: 's1',
			chatTabId: 'tab-1',
			workspaceId: 'w1',
		});
		expect(store.isOnScreen(ask('s2', 'tab-2'))).toBe(false);
	});

	test('does not match a chat whose tab could not be resolved', () => {
		const store = new ActiveChatStore();
		store.apply({
			agentSessionId: null,
			chatTabId: 'tab-1',
			workspaceId: 'w1',
		});
		expect(store.isOnScreen(ask('s1', null))).toBe(false);
	});

	test('does not match the same ids in another workspace', () => {
		const store = new ActiveChatStore();
		store.apply({
			agentSessionId: 's1',
			chatTabId: 'tab-1',
			workspaceId: 'w1',
		});
		expect(store.isOnScreen(ask('s1', 'tab-1', 'w2'))).toBe(false);
	});

	test('forgets the chat when the renderer reports none', () => {
		const store = new ActiveChatStore();
		store.apply({
			agentSessionId: 's1',
			chatTabId: 'tab-1',
			workspaceId: 'w1',
		});
		store.apply(null);
		expect(store.isOnScreen(ask('s1', 'tab-1'))).toBe(false);
	});
});
