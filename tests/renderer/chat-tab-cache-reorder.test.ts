import { describe, expect, test } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import { writeReorderedChatTabsToCache } from '../../src/renderer/api/ensemblr-queries';
import type {
	ChatTabWire,
	ListChatTabsResult,
} from '../../src/shared/ipc/contracts/chat-tab';
import { createTestQueryClient } from './support/dom';

const WORKSPACE_ID = 'workspace-1';

/** Builds a minimal open chat-tab wire row for cache seeding. */
function createTab(id: string, position: number): ChatTabWire {
	return {
		closedAt: null,
		id,
		kind: 'chat',
		metadata: {},
		openedAt: `2026-07-11T00:00:0${position}.000Z`,
		piSessionId: null,
		position,
		title: id,
		workspaceId: WORKSPACE_ID,
	};
}

/** Seeds the chat-tab cache and returns the query client plus read helper. */
function seedCache(open: ChatTabWire[]) {
	const queryClient = createTestQueryClient();
	queryClient.setQueryData<ListChatTabsResult>(
		ensemblrQueryKeys.chatTabs(WORKSPACE_ID),
		{ closed: [], open },
	);
	const read = () =>
		queryClient.getQueryData<ListChatTabsResult>(
			ensemblrQueryKeys.chatTabs(WORKSPACE_ID),
		);
	return { queryClient, read };
}

describe('writeReorderedChatTabsToCache', () => {
	test('rewrites open-tab order and contiguous positions', () => {
		const { queryClient, read } = seedCache([
			createTab('a', 0),
			createTab('b', 1),
			createTab('c', 2),
		]);

		writeReorderedChatTabsToCache({
			orderedIds: ['c', 'a', 'b'],
			queryClient,
			workspaceId: WORKSPACE_ID,
		});

		expect(read()?.open.map((tab) => [tab.id, tab.position])).toEqual([
			['c', 0],
			['a', 1],
			['b', 2],
		]);
	});

	test('keeps unknown ids out and appends untouched tabs at the end', () => {
		const { queryClient, read } = seedCache([
			createTab('a', 0),
			createTab('b', 1),
			createTab('c', 2),
		]);

		writeReorderedChatTabsToCache({
			orderedIds: ['c', 'missing', 'c'],
			queryClient,
			workspaceId: WORKSPACE_ID,
		});

		expect(read()?.open.map((tab) => tab.id)).toEqual(['c', 'a', 'b']);
	});

	test('is a no-op when no chat-tab cache entry exists', () => {
		const queryClient = createTestQueryClient();

		writeReorderedChatTabsToCache({
			orderedIds: ['a'],
			queryClient,
			workspaceId: WORKSPACE_ID,
		});

		expect(
			queryClient.getQueryData(ensemblrQueryKeys.chatTabs(WORKSPACE_ID)),
		).toBeUndefined();
	});
});
