// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const {
	navigate,
	invalidate,
	invalidateWorkspaceListViews,
	disableProjectReorderLayoutAnimation,
	deleteLastUsedOpenTarget,
} = vi.hoisted(() => ({
	navigate: vi.fn().mockResolvedValue(undefined),
	invalidate: vi.fn().mockResolvedValue(undefined),
	invalidateWorkspaceListViews: vi.fn().mockResolvedValue(undefined),
	disableProjectReorderLayoutAnimation: vi.fn(),
	deleteLastUsedOpenTarget: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => navigate,
	useRouter: () => ({ invalidate }),
}));

vi.mock('@/renderer/api/ensemblr', () => ({
	createWorkspace: vi.fn(),
	ensemblrQueryKeys: { repositoryWorkspaceNavigation: () => ['nav'] },
	invalidateWorkspaceListViews,
	isEnsemblrApiAvailable: () => true,
}));

vi.mock('@/renderer/state/workspace', () => ({
	useDisableProjectReorderLayoutAnimation: () =>
		disableProjectReorderLayoutAnimation,
}));

vi.mock('@/renderer/state/workspace/open-target-history', () => ({
	deleteLastUsedOpenTarget,
}));

import { useRemoveWorkspaceAction } from '@/renderer/hooks/workbench-shell/use-remove-workspace-action';

/**
 * Renders the shared workspace-removal action for navigation and cache assertions.
 */
function renderRemoveWorkspaceAction(activeWorkspaceId: string | null) {
	const queryClient = new QueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	return renderHook(() => useRemoveWorkspaceAction({ activeWorkspaceId }), {
		wrapper,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
});

test('redirects to Welcome when the archived workspace is the active one', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio');

	await act(async () => {
		await view.result.current('san-antonio');
	});

	expect(disableProjectReorderLayoutAnimation).toHaveBeenCalledTimes(1);
	expect(deleteLastUsedOpenTarget).toHaveBeenCalledWith('san-antonio');
	expect(navigate).toHaveBeenCalledWith({ replace: true, to: '/' });
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
	expect(invalidate).toHaveBeenCalledTimes(1);
});

test('leaves navigation untouched when a background workspace is archived', async () => {
	const view = renderRemoveWorkspaceAction('san-antonio');

	await act(async () => {
		await view.result.current('some-other-workspace');
	});

	expect(navigate).not.toHaveBeenCalled();
	expect(disableProjectReorderLayoutAnimation).toHaveBeenCalledTimes(1);
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
	expect(invalidate).toHaveBeenCalledTimes(1);
});

test('still refreshes list views when there is no active workspace', async () => {
	const view = renderRemoveWorkspaceAction(null);

	await act(async () => {
		await view.result.current('san-antonio');
	});

	expect(navigate).not.toHaveBeenCalled();
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
});
