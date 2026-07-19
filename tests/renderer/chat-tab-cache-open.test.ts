import { describe, expect, test } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import { writeOpenedChatTabToCache } from '../../src/renderer/api/ensemblr-queries';
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

describe('writeOpenedChatTabToCache', () => {
	test('appends the opened tab without dropping existing siblings', () => {
		const { queryClient, read } = seedCache([createTab('a', 0)]);

		writeOpenedChatTabToCache({
			queryClient,
			tab: createTab('b', 1),
			workspaceId: WORKSPACE_ID,
		});

		expect(read()?.open.map((tab) => tab.id)).toEqual(['a', 'b']);
	});

	test('orders the merged tabs by persisted strip position', () => {
		const { queryClient, read } = seedCache([createTab('a', 1)]);

		writeOpenedChatTabToCache({
			queryClient,
			tab: createTab('b', 0),
			workspaceId: WORKSPACE_ID,
		});

		expect(read()?.open.map((tab) => tab.id)).toEqual(['b', 'a']);
	});

	test('replaces an existing row for the same id rather than duplicating it', () => {
		const { queryClient, read } = seedCache([
			createTab('a', 0),
			createTab('b', 1),
		]);

		writeOpenedChatTabToCache({
			queryClient,
			tab: { ...createTab('a', 0), title: 'renamed' },
			workspaceId: WORKSPACE_ID,
		});

		const open = read()?.open ?? [];
		expect(open.map((tab) => tab.id)).toEqual(['a', 'b']);
		expect(open.find((tab) => tab.id === 'a')?.title).toBe('renamed');
	});

	test('leaves the cache untouched when no snapshot exists yet', () => {
		const queryClient = createTestQueryClient();

		writeOpenedChatTabToCache({
			queryClient,
			tab: createTab('a', 0),
			workspaceId: WORKSPACE_ID,
		});

		expect(
			queryClient.getQueryData(ensemblrQueryKeys.chatTabs(WORKSPACE_ID)),
		).toBeUndefined();
	});
});
