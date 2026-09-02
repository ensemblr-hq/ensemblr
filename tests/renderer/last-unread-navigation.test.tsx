// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createStore, getDefaultStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { listChatTabs, navigate, navigateToWorkspace } = vi.hoisted(() => ({
	listChatTabs: vi.fn(),
	navigate: vi.fn(),
	navigateToWorkspace: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

// The jump refuses an archiving workspace, which it reads through the
// workspace-state barrel — and that pulls the shared query client in with it, so
// the mock has to carry the key factory that module reads at import time.
vi.mock('@/renderer/api/ensemblr-queries', () => ({
	ensemblrQueryKeys: {
		agentModels: () => ['agent-models'],
		health: () => ['health'],
		repositoryWorkspaceNavigation: () => ['repository-workspace-navigation'],
		reviewComments: (workspaceId: string) => ['review-comments', workspaceId],
		workspaceOpenTargets: () => ['workspace-open-targets'],
	},
	listChatTabsQuery: (workspaceId: string) => ({
		queryFn: () => listChatTabs(workspaceId),
		queryKey: ['chat-tabs', workspaceId],
	}),
}));

import { WorkbenchLayoutModelProvider } from '../../src/renderer/components/workbench-shell/shell-contexts';
import { shellFixtureProjects } from '../../src/renderer/fixtures/workbench';
import { useNavigateToLastUnread } from '../../src/renderer/hooks/workbench-shell/composer/use-navigate-to-last-unread';
import type { UnreadChatEntry } from '../../src/renderer/state/unread';
import { unreadChatEntriesAtom } from '../../src/renderer/state/unread/atoms';
import { archivingWorkspaceIdsAtom } from '../../src/renderer/state/workspace/workspace-archiving';
import type { WorkbenchLayoutModel } from '../../src/renderer/types/workbench-shell';
import { createTestQueryClient } from './support/dom';

const project = shellFixtureProjects[0];
const workspace = project.workspaces[0];

const layoutModel = {
	displayProjects: shellFixtureProjects,
	navigateToWorkspace,
	resolveWorkspaceRouteSearch: () => ({ dock: 'setup', review: 'files' }),
} as unknown as WorkbenchLayoutModel;

/** An unread mark against the fixture workspace, tab id optional. */
function target(chatTabId: string | null): UnreadChatEntry {
	return {
		agentSessionId: 'session-7',
		chatTabId,
		lastMessageAt: 1,
		reason: 'turn-finished',
		workspaceId: workspace.id,
	};
}

/**
 * Mounts the hook under the layout-model provider, a fresh query client, and an
 * isolated store already holding the marks a case expects to survive or be
 * dropped.
 */
function renderNavigate(marks: UnreadChatEntry[] = []) {
	const client = createTestQueryClient();
	const store = createStore();
	store.set(unreadChatEntriesAtom, marks);
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>
			<QueryClientProvider client={client}>
				<WorkbenchLayoutModelProvider value={layoutModel}>
					{children}
				</WorkbenchLayoutModelProvider>
			</QueryClientProvider>
		</Provider>
	);
	return { store, ...renderHook(() => useNavigateToLastUnread(), { wrapper }) };
}

beforeEach(() => {
	listChatTabs.mockReset();
	navigate.mockReset();
	navigateToWorkspace.mockReset();
	window.localStorage?.clear();
});

test('routes straight to a mark that already knows its tab', async () => {
	const { result } = renderNavigate();
	await act(async () => {
		await result.current(target('tab-7'));
	});

	expect(listChatTabs).not.toHaveBeenCalled();
	expect(navigate).toHaveBeenCalledWith({
		params: {
			chatId: 'tab-7',
			projectId: project.id,
			workspaceId: workspace.id,
		},
		search: { dock: 'setup', review: 'files' },
		to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
	});
});

test('retires the mark it acted on, so a jump to the routed chat dismisses it', async () => {
	const { result, store } = renderNavigate([target('tab-7')]);
	await act(async () => {
		await result.current(target('tab-7'));
	});

	expect(store.get(unreadChatEntriesAtom)).toEqual([]);
});

test('resolves the tab from the session id when the mark has none', async () => {
	listChatTabs.mockResolvedValue({
		closed: [],
		open: [
			{ agentSessionId: 'session-other', id: 'tab-other' },
			{ agentSessionId: 'session-7', id: 'tab-7' },
		],
	});
	const { result } = renderNavigate();
	await act(async () => {
		await result.current(target(null));
	});

	expect(listChatTabs).toHaveBeenCalledWith(workspace.id);
	expect(navigate.mock.calls[0][0].params.chatId).toBe('tab-7');
});

test('falls back to the workspace when the session has no open tab', async () => {
	listChatTabs.mockResolvedValue({ closed: [], open: [] });
	const { result } = renderNavigate();
	await act(async () => {
		await result.current(target(null));
	});

	expect(navigate).not.toHaveBeenCalled();
	expect(navigateToWorkspace).toHaveBeenCalledWith(project.id, workspace.id);
});

test('drops a mark whose tab is gone, so the jump control does not stick', async () => {
	listChatTabs.mockResolvedValue({ closed: [], open: [] });
	const { result, store } = renderNavigate([target(null)]);
	await act(async () => {
		await result.current(target(null));
	});

	expect(store.get(unreadChatEntriesAtom)).toEqual([]);
});

test('falls back to the workspace when the tab lookup fails', async () => {
	listChatTabs.mockRejectedValue(new Error('ipc down'));
	const { result } = renderNavigate();
	await act(async () => {
		await result.current(target(null));
	});

	expect(navigateToWorkspace).toHaveBeenCalledWith(project.id, workspace.id);
});

test('does not navigate when no project holds the marked workspace', async () => {
	const gone = { ...target('tab-7'), workspaceId: 'ws-gone' };
	const { result, store } = renderNavigate([gone]);
	await act(async () => {
		await result.current(gone);
	});

	expect(navigate).not.toHaveBeenCalled();
	expect(navigateToWorkspace).not.toHaveBeenCalled();
	expect(store.get(unreadChatEntriesAtom)).toEqual([]);
});

// A workspace mid-archive is losing the worktree the chat lives in, and the
// mark survives because a vetoed archive leaves the workspace — and the unread
// chat in it — whole.
test('refuses a jump into a workspace being archived, keeping the mark', async () => {
	getDefaultStore().set(archivingWorkspaceIdsAtom, new Set([workspace.id]));
	const mark = target('tab-7');
	const { result, store } = renderNavigate([mark]);

	await act(async () => {
		await result.current(mark);
	});

	expect(navigate).not.toHaveBeenCalled();
	expect(navigateToWorkspace).not.toHaveBeenCalled();
	expect(listChatTabs).not.toHaveBeenCalled();
	expect(store.get(unreadChatEntriesAtom)).toEqual([mark]);
});

afterEach(() => {
	getDefaultStore().set(archivingWorkspaceIdsAtom, new Set<string>());
});
