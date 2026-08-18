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
	invalidateWorkspaceListViews,
	isEnsemblrApiAvailable: () => true,
}));

vi.mock('@/renderer/state/workspace/open-target-history', () => ({
	deleteLastUsedOpenTarget,
}));

import { useRemoveWorkspaceAction } from '@/renderer/hooks/workbench-shell/use-remove-workspace-action';
import { lastWorkspaceSelectionAtom } from '@/renderer/state/workspace';
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
			selection: useAtomValue(lastWorkspaceSelectionAtom),
		}),
		{ wrapper },
	);
}

beforeEach(() => {
	installLocalStorage();
	vi.clearAllMocks();
	calls.length = 0;
});

test('routes away from the archived workspace when it is the active one', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio');

	await act(async () => {
		await view.result.current.remove('san-antonio');
	});

	expect(deleteLastUsedOpenTarget).toHaveBeenCalledWith('san-antonio');
	expect(navigate).toHaveBeenCalledWith({ replace: true, to: '/' });
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
});

test('hops off the archived workspace before the lists drop it from under the shell', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio');

	await act(async () => {
		await view.result.current.remove('san-antonio');
	});

	expect(calls).toEqual(['navigate', 'invalidateWorkspaceListViews']);
});

test('skips the router invalidation the navigation already performed', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio');

	await act(async () => {
		await view.result.current.remove('san-antonio');
	});

	expect(invalidate).not.toHaveBeenCalled();
});

test('keeps the stored selection so the index loader falls back within its project', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio', {
		projectId: 'ensemblr',
		workspaceId: 'san-antonio',
	});

	await act(async () => {
		await view.result.current.remove('san-antonio');
	});

	expect(view.result.current.selection).toEqual({
		projectId: 'ensemblr',
		workspaceId: 'san-antonio',
	});
});

test('leaves navigation untouched when a background workspace is archived', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio');

	await act(async () => {
		await view.result.current.remove('some-other-workspace');
	});

	expect(navigate).not.toHaveBeenCalled();
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
	expect(invalidate).toHaveBeenCalledTimes(1);
});

test('still refreshes list views when there is no active workspace', async () => {
	const view = renderRemoveWorkspaceAction(null);

	await act(async () => {
		await view.result.current.remove('san-antonio');
	});

	expect(navigate).not.toHaveBeenCalled();
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
});
