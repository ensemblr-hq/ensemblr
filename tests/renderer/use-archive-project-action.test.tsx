// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

const {
	invalidateWorkspaceListViews,
	navigate,
	queryClient,
	routerInvalidate,
} = vi.hoisted(() => ({
	invalidateWorkspaceListViews: vi.fn().mockResolvedValue(undefined),
	navigate: vi.fn().mockResolvedValue(undefined),
	queryClient: { setQueryData: vi.fn() },
	routerInvalidate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => navigate,
	useRouter: () => ({ invalidate: routerInvalidate }),
}));

vi.mock('sonner', () => ({
	toast: { error: vi.fn() },
}));

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	createWorkspace: vi.fn(),
	ensemblrQueryKeys: { repositoryWorkspaceNavigation: () => ['nav'] },
	invalidateWorkspaceListViews,
	isEnsemblrApiAvailable: () => true,
}));

vi.mock('@/renderer/api/query-client', () => ({ queryClient }));

import { useArchiveProjectAction } from '../../src/renderer/hooks/workbench-shell/navigation-sidebar/use-project-navigation-actions';

beforeEach(() => {
	vi.clearAllMocks();
});

test('redirects to Welcome when the archived project is the active one', async () => {
	const view = renderHook(() =>
		useArchiveProjectAction({ activeProjectId: 'repo-1' }),
	);

	await act(async () => {
		await view.result.current('repo-1');
	});

	expect(navigate).toHaveBeenCalledWith({ replace: true, to: '/' });
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
	expect(routerInvalidate).toHaveBeenCalledTimes(1);
});

test('leaves navigation untouched when a background project is archived', async () => {
	const view = renderHook(() =>
		useArchiveProjectAction({ activeProjectId: 'repo-1' }),
	);

	await act(async () => {
		await view.result.current('repo-2');
	});

	expect(navigate).not.toHaveBeenCalled();
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
	expect(routerInvalidate).toHaveBeenCalledTimes(1);
});

test('still refreshes list views when there is no active project', async () => {
	const view = renderHook(() =>
		useArchiveProjectAction({ activeProjectId: null }),
	);

	await act(async () => {
		await view.result.current('repo-1');
	});

	expect(navigate).not.toHaveBeenCalled();
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
});
