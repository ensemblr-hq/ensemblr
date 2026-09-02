// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider, useAtomValue } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const {
	navigate,
	invalidate,
	invalidateWorkspaceListViews,
	forgetWorkspaceInListViews,
	deleteLastUsedOpenTarget,
	calls,
} = vi.hoisted(() => {
	const calls: string[] = [];
	return {
		navigate: vi.fn(async () => {
			calls.push('navigate');
		}),
		invalidate: vi.fn(async () => {
			calls.push('invalidate');
		}),
		invalidateWorkspaceListViews: vi.fn(async () => {
			calls.push('invalidateWorkspaceListViews');
		}),
		forgetWorkspaceInListViews: vi.fn(() => {
			calls.push('forgetWorkspaceInListViews');
		}),
		deleteLastUsedOpenTarget: vi.fn(),
		calls,
	};
});

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => navigate,
	useRouter: () => ({ invalidate }),
}));

vi.mock('@/renderer/api/ensemblr', () => ({
	createWorkspace: vi.fn(),
	ensemblrQueryKeys: {
		agentModels: () => ['pi-models'],
		repositoryWorkspaceNavigation: () => ['nav'],
	},
	forgetWorkspaceInListViews,
	invalidateWorkspaceListViews,
	isEnsemblrApiAvailable: () => true,
}));

vi.mock('@/renderer/state/workspace/open-target-history', () => ({
	deleteLastUsedOpenTarget,
}));

import {
	useRemoveHoppedWorkspaceAction,
	useRemoveWorkspaceAction,
} from '@/renderer/hooks/workbench-shell/use-remove-workspace-action';
import { lastWorkspaceSelectionAtom } from '@/renderer/state/workspace';
import { activeChatTabByWorkspaceAtom } from '@/renderer/state/workspace/selection-atoms';
import { pinnedWorkspaceIdsAtom } from '@/renderer/state/workspace/structure-atoms';
import { installLocalStorage } from './support/dom';

/**
 * Renders the shared workspace-removal action for navigation and cache
 * assertions, exposing the persisted selection the workbench index loader reads.
 */
function renderRemoveWorkspaceAction(
	activeWorkspaceId: string | null,
	storedSelection: { projectId: string; workspaceId: string } | null = null,
) {
	const queryClient = new QueryClient();
	const store = createStore();
	store.set(lastWorkspaceSelectionAtom, storedSelection);
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>
			<Provider store={store}>{children}</Provider>
		</QueryClientProvider>
	);
	return renderHook(
		() => ({
			remove: useRemoveWorkspaceAction({ activeWorkspaceId }),
			removeAfterHop: useRemoveHoppedWorkspaceAction({ activeWorkspaceId }),
			selection: useAtomValue(lastWorkspaceSelectionAtom),
			store,
		}),
		{ wrapper },
	);
}

beforeEach(() => {
	installLocalStorage();
	vi.clearAllMocks();
	calls.length = 0;
});

test('drops the deleted workspace from the lists when it is the active one', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio');

	await act(async () => {
		await view.result.current.remove.deleted('san-antonio');
	});

	expect(deleteLastUsedOpenTarget).toHaveBeenCalledWith('san-antonio');
	expect(forgetWorkspaceInListViews).toHaveBeenCalledWith(
		expect.anything(),
		'san-antonio',
	);
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
});

// Archiving is reversible from History and Browse archive, so an unarchived
// workspace has to come back with the board column, pin, tabs and run script it
// had. Only a delete may evict those.
test('keeps the workspace memory when it is archived rather than deleted', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio');
	const store = view.result.current.store;
	store.set(activeChatTabByWorkspaceAtom, { 'san-antonio': 'tab-1' });
	store.set(pinnedWorkspaceIdsAtom, ['san-antonio']);

	await act(async () => {
		await view.result.current.remove.archived('san-antonio');
	});

	expect(deleteLastUsedOpenTarget).not.toHaveBeenCalled();
	expect(store.get(activeChatTabByWorkspaceAtom)).toEqual({
		'san-antonio': 'tab-1',
	});
	expect(store.get(pinnedWorkspaceIdsAtom)).toEqual(['san-antonio']);
	expect(forgetWorkspaceInListViews).toHaveBeenCalledWith(
		expect.anything(),
		'san-antonio',
	);
});

test('clears the workspace memory when it is deleted', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio');
	const store = view.result.current.store;
	store.set(activeChatTabByWorkspaceAtom, {
		'san-antonio': 'tab-1',
		survivor: 'tab-2',
	});
	store.set(pinnedWorkspaceIdsAtom, ['san-antonio', 'survivor']);

	await act(async () => {
		await view.result.current.remove.deleted('san-antonio');
	});

	expect(store.get(activeChatTabByWorkspaceAtom)).toEqual({
		survivor: 'tab-2',
	});
	expect(store.get(pinnedWorkspaceIdsAtom)).toEqual(['survivor']);
});

// The cached drop leaves the workspace layout selectionless and it redirects
// itself. Navigating here as well put two replace-hops to '/' in flight at once,
// and ran the index loader — which can redirect on to a sibling workspace —
// twice against a cache still settling.
test('leaves the hop to the layout instead of racing it with its own navigate', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio');

	await act(async () => {
		await view.result.current.remove.deleted('san-antonio');
	});

	expect(navigate).not.toHaveBeenCalled();
	expect(calls).toEqual([
		'forgetWorkspaceInListViews',
		'invalidateWorkspaceListViews',
	]);
});

// Everything after the drop re-reads through the main process, so none of it may
// be what keeps a removed workspace on screen.
test('drops the workspace from the lists before the refetch settles', async () => {
	invalidateWorkspaceListViews.mockImplementationOnce(
		() => new Promise<void>(() => {}),
	);
	const view = renderRemoveWorkspaceAction('san-antonio');

	await act(async () => {
		void view.result.current.remove.deleted('san-antonio');
		await Promise.resolve();
	});

	expect(forgetWorkspaceInListViews).toHaveBeenCalledWith(
		expect.anything(),
		'san-antonio',
	);
});

test('skips the router invalidation the layout redirect already performed', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio');

	await act(async () => {
		await view.result.current.remove.deleted('san-antonio');
	});

	expect(invalidate).not.toHaveBeenCalled();
});

test('keeps the stored selection so the index loader falls back within its project', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio', {
		projectId: 'ensemblr',
		workspaceId: 'san-antonio',
	});

	await act(async () => {
		await view.result.current.remove.deleted('san-antonio');
	});

	expect(view.result.current.selection).toEqual({
		projectId: 'ensemblr',
		workspaceId: 'san-antonio',
	});
});

test('leaves navigation untouched when a background workspace is removed', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio');

	await act(async () => {
		await view.result.current.remove.deleted('some-other-workspace');
	});

	expect(navigate).not.toHaveBeenCalled();
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
	expect(invalidate).toHaveBeenCalledTimes(1);
});

test('still refreshes list views when there is no active workspace', async () => {
	const view = renderRemoveWorkspaceAction(null);

	await act(async () => {
		await view.result.current.remove.deleted('san-antonio');
	});

	expect(navigate).not.toHaveBeenCalled();
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
});

// The teardown hop leaves the active workspace before the IPC, which spends the
// layout's missing-selection redirect — so by the time the workspace is gone
// nothing is left to re-run the loaders. The hop-aware action adds back exactly
// the one invalidation that redirect used to cover.
test('invalidates the router for the active workspace it was hopped off', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio');

	await act(async () => {
		await view.result.current.removeAfterHop.deleted('san-antonio');
	});

	expect(invalidate).toHaveBeenCalledTimes(1);
});

test('invalidates the router for an active workspace it archived', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio');

	await act(async () => {
		await view.result.current.removeAfterHop.archived('san-antonio');
	});

	expect(invalidate).toHaveBeenCalledTimes(1);
});

// A workspace the user is not standing in was never hopped off, so the plain
// action already invalidated and a second one would run the index loader twice.
test('leaves the invalidation alone for a workspace the user is not in', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio');

	await act(async () => {
		await view.result.current.removeAfterHop.deleted('el-paso');
	});

	expect(invalidate).toHaveBeenCalledTimes(1);
});
