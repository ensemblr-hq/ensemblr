// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatTabWire } from '@/shared/ipc/contracts/chat-tab';

const listChatTabs = vi.hoisted(() => vi.fn());

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	listChatTabsQuery: (workspaceId: string) => ({
		enabled: workspaceId.length > 0,
		queryFn: listChatTabs,
		queryKey: ['chat-tabs', workspaceId],
	}),
}));

const { useWorkspaceChatReferences } = await import(
	'@/renderer/hooks/workbench-shell/composer/use-workspace-chat-references'
);
const { QueryClient, QueryClientProvider } = await import(
	'@tanstack/react-query'
);
const { createElement } = await import('react');

/** A chat-tab row carrying only what the reference builder reads off it. */
function tab(overrides: Partial<ChatTabWire> & { id: string }): ChatTabWire {
	return {
		agentSessionId: `session-${overrides.id}`,
		closedAt: null,
		fullTitle: '',
		isPreview: false,
		kind: 'chat',
		metadata: {},
		openedAt: '2026-09-01T00:00:00.000Z',
		position: 0,
		title: overrides.id,
		workspaceId: 'ws-1',
		...overrides,
	} as ChatTabWire;
}

/** Renders the hook against a stubbed listing and returns what it produced. */
async function references(result: {
	closed?: readonly ChatTabWire[];
	open?: readonly ChatTabWire[];
}) {
	listChatTabs.mockResolvedValue({
		closed: result.closed ?? [],
		open: result.open ?? [],
	});
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { result: hook } = renderHook(
		() =>
			useWorkspaceChatReferences({
				excludeChatTabId: 'tab-self',
				workspaceId: 'ws-1',
				workspaceName: 'khachaturian',
			}),
		{
			wrapper: ({ children }) =>
				createElement(QueryClientProvider, { client }, children),
		},
	);
	await vi.waitFor(() => expect(listChatTabs).toHaveBeenCalled());
	await vi.waitFor(() => expect(hook.current).not.toBeUndefined());
	return hook;
}

describe("the chats a workspace's composer can point at", () => {
	beforeEach(() => {
		listChatTabs.mockReset();
	});

	it('leaves out the tab the composer itself belongs to', async () => {
		const hook = await references({
			open: [tab({ id: 'tab-self', title: 'This chat' }), tab({ id: 'tab-1' })],
		});

		await vi.waitFor(() => expect(hook.current).toHaveLength(1));
		expect(hook.current[0]).toMatchObject({ chatTabId: 'tab-1' });
	});

	it('offers the open tabs before the closed ones', async () => {
		const hook = await references({
			closed: [tab({ closedAt: '2026-09-02T00:00:00.000Z', id: 'tab-old' })],
			open: [tab({ id: 'tab-live' })],
		});

		await vi.waitFor(() => expect(hook.current).toHaveLength(2));
		expect(hook.current.map((reference) => reference.label)).toEqual([
			'tab-live',
			'tab-old',
		]);
		expect(hook.current[1]).toMatchObject({ state: 'closed' });
	});

	it('leaves out a tab that is not a conversation', async () => {
		const hook = await references({
			open: [tab({ id: 'tab-file', kind: 'file' }), tab({ id: 'tab-1' })],
		});

		await vi.waitFor(() => expect(hook.current).toHaveLength(1));
		expect(hook.current[0]).toMatchObject({ chatTabId: 'tab-1' });
	});

	it('carries the workspace name and the session the agent would read', async () => {
		const hook = await references({ open: [tab({ id: 'tab-1' })] });

		await vi.waitFor(() => expect(hook.current).toHaveLength(1));
		expect(hook.current[0]).toMatchObject({
			agentSessionId: 'session-tab-1',
			kind: 'chat',
			role: 'orchestrator',
			workspace: 'khachaturian',
			workspaceId: 'ws-1',
		});
	});

	it('reads a spawned sub-agent off its own marker', async () => {
		const hook = await references({
			open: [tab({ id: 'tab-1', metadata: { agentRole: 'subagent' } })],
		});

		await vi.waitFor(() => expect(hook.current).toHaveLength(1));
		expect(hook.current[0]).toMatchObject({ role: 'subagent' });
	});
});
