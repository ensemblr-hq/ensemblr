import { describe, expect, test } from 'vitest';
import type { UnreadChatEntry } from '../../src/renderer/state/unread/atoms';
import { MAX_UNREAD_ENTRIES } from '../../src/renderer/state/unread/atoms';
import {
	clearChatUnread,
	clearWorkspaceUnread,
	collectWorkspaceUnreadKeys,
	countWorkspaceUnread,
	markChatUnread,
	retainKnownWorkspaces,
	selectLastUnread,
} from '../../src/renderer/state/unread/entries';

/** Builds an entry with the ids a case cares about and sane defaults elsewhere. */
function entry(overrides: Partial<UnreadChatEntry> = {}): UnreadChatEntry {
	return {
		agentSessionId: 'session-a',
		chatTabId: 'tab-a',
		lastMessageAt: 1,
		reason: 'turn-finished',
		workspaceId: 'ws-1',
		...overrides,
	};
}

describe('markChatUnread', () => {
	test('appends a new chat so the tail is the newest mark', () => {
		const next = markChatUnread(
			[entry()],
			entry({ chatTabId: 'tab-b', agentSessionId: 'session-b' }),
		);
		expect(next.map((item) => item.chatTabId)).toEqual(['tab-a', 'tab-b']);
	});

	test('replaces an existing mark for the same chat and moves it to the end', () => {
		const first = entry({ agentSessionId: 'session-a', chatTabId: 'tab-a' });
		const second = entry({ agentSessionId: 'session-b', chatTabId: 'tab-b' });
		const next = markChatUnread(
			[first, second],
			entry({
				agentSessionId: 'session-a',
				chatTabId: 'tab-a',
				lastMessageAt: 9,
			}),
		);
		expect(next).toHaveLength(2);
		expect(next.at(-1)?.chatTabId).toBe('tab-a');
		expect(next.at(-1)?.lastMessageAt).toBe(9);
	});

	test('keeps a tab id already known when the new mark has none', () => {
		const next = markChatUnread(
			[entry({ chatTabId: 'tab-a' })],
			entry({ chatTabId: null, reason: 'question' }),
		);
		expect(next.at(-1)).toMatchObject({
			chatTabId: 'tab-a',
			reason: 'question',
		});
	});

	test('matches an existing session-only mark, rather than duplicating it', () => {
		const next = markChatUnread(
			[entry({ chatTabId: null })],
			entry({ chatTabId: 'tab-a' }),
		);
		expect(next).toHaveLength(1);
		expect(next[0].chatTabId).toBe('tab-a');
	});

	test('does not merge chats that share an id across different workspaces', () => {
		const next = markChatUnread(
			[entry({ workspaceId: 'ws-1' })],
			entry({ workspaceId: 'ws-2' }),
		);
		expect(next).toHaveLength(2);
	});

	test('trims from the front past the cap', () => {
		const full = Array.from({ length: MAX_UNREAD_ENTRIES }, (_unused, index) =>
			entry({ agentSessionId: `session-${index}`, chatTabId: `tab-${index}` }),
		);
		const next = markChatUnread(
			full,
			entry({ agentSessionId: 'newest', chatTabId: 'newest' }),
		);
		expect(next).toHaveLength(MAX_UNREAD_ENTRIES);
		expect(next[0].chatTabId).toBe('tab-1');
		expect(next.at(-1)?.chatTabId).toBe('newest');
	});
});

describe('clearChatUnread', () => {
	test('clears a mark by its tab id', () => {
		const next = clearChatUnread([entry()], {
			chatTabId: 'tab-a',
			workspaceId: 'ws-1',
		});
		expect(next).toEqual([]);
	});

	test('clears a session-only mark by its session id', () => {
		const next = clearChatUnread([entry({ chatTabId: null })], {
			agentSessionId: 'session-a',
			chatTabId: 'tab-a',
			workspaceId: 'ws-1',
		});
		expect(next).toEqual([]);
	});

	test('returns the same list when nothing matched', () => {
		const entries = [entry()];
		expect(
			clearChatUnread(entries, { chatTabId: 'other', workspaceId: 'ws-1' }),
		).toBe(entries);
	});

	test('leaves other tabs in the same workspace marked', () => {
		const entries = [
			entry({ agentSessionId: 'session-a', chatTabId: 'tab-a' }),
			entry({ agentSessionId: 'session-b', chatTabId: 'tab-b' }),
		];
		const next = clearChatUnread(entries, {
			chatTabId: 'tab-a',
			workspaceId: 'ws-1',
		});
		expect(next.map((item) => item.chatTabId)).toEqual(['tab-b']);
	});
});

describe('clearWorkspaceUnread', () => {
	test('drops every mark for one workspace and keeps the rest', () => {
		const entries = [
			entry({ workspaceId: 'ws-1' }),
			entry({ workspaceId: 'ws-2' }),
		];
		expect(clearWorkspaceUnread(entries, 'ws-1')).toEqual([
			entry({ workspaceId: 'ws-2' }),
		]);
	});

	test('returns the same list when the workspace held none', () => {
		const entries = [entry()];
		expect(clearWorkspaceUnread(entries, 'ws-other')).toBe(entries);
	});
});

describe('retainKnownWorkspaces', () => {
	test('drops marks whose workspace is gone', () => {
		const entries = [
			entry({ workspaceId: 'ws-1' }),
			entry({ workspaceId: 'ws-archived' }),
		];
		expect(retainKnownWorkspaces(entries, new Set(['ws-1']))).toEqual([
			entry({ workspaceId: 'ws-1' }),
		]);
	});

	test('returns the same list when every mark is still live', () => {
		const entries = [entry({ workspaceId: 'ws-1' })];
		expect(retainKnownWorkspaces(entries, new Set(['ws-1', 'ws-2']))).toBe(
			entries,
		);
	});
});

describe('selectLastUnread', () => {
	test('returns the tail entry', () => {
		const newest = entry({ chatTabId: 'tab-b' });
		expect(selectLastUnread([entry(), newest])).toBe(newest);
	});

	test('returns null when nothing is unread', () => {
		expect(selectLastUnread([])).toBeNull();
	});
});

describe('countWorkspaceUnread', () => {
	test('counts only the named workspace', () => {
		const entries = [
			entry({ chatTabId: 'tab-a', workspaceId: 'ws-1' }),
			entry({ chatTabId: 'tab-b', workspaceId: 'ws-1' }),
			entry({ chatTabId: 'tab-c', workspaceId: 'ws-2' }),
		];
		expect(countWorkspaceUnread(entries, 'ws-1')).toBe(2);
	});
});

describe('collectWorkspaceUnreadKeys', () => {
	test('collects both ids, skipping a null tab id', () => {
		const keys = collectWorkspaceUnreadKeys(
			[
				entry({ agentSessionId: 'session-a', chatTabId: 'tab-a' }),
				entry({ agentSessionId: 'session-b', chatTabId: null }),
				entry({
					agentSessionId: 'session-c',
					chatTabId: 'tab-c',
					workspaceId: 'ws-2',
				}),
			],
			'ws-1',
		);
		expect([...keys].sort()).toEqual(['session-a', 'session-b', 'tab-a']);
	});
});
