// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

const { navigate, invalidate, invalidateWorkspaceListViews } = vi.hoisted(
	() => ({
		navigate: vi.fn().mockResolvedValue(undefined),
		invalidate: vi.fn().mockResolvedValue(undefined),
		invalidateWorkspaceListViews: vi.fn().mockResolvedValue(undefined),
	}),
);

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => navigate,
	useRouter: () => ({ invalidate }),
}));

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	createWorkspace: vi.fn(),
	ensemblrQueryKeys: { repositoryWorkspaceNavigation: () => ['nav'] },
	invalidateWorkspaceListViews,
	isEnsemblrApiAvailable: () => true,
}));

vi.mock('@/renderer/api/query-client', () => ({ queryClient: {} }));

import { useArchiveWorkspaceAction } from '@/renderer/hooks/workbench-shell/navigation-sidebar/use-project-navigation-actions';

/**
 * Renders the archive-workspace action hook with a spy for the reorder-animation
 * disabler, returning the exposed callback plus that spy for assertions.
 */
function renderArchiveAction(activeWorkspaceId: string | null) {
	const disableProjectReorderLayoutAnimation = vi.fn();
	const view = renderHook(() =>
		useArchiveWorkspaceAction({
			activeWorkspaceId,
			disableProjectReorderLayoutAnimation,
		}),
	);
	return { disableProjectReorderLayoutAnimation, view };
}

beforeEach(() => {
	vi.clearAllMocks();
});

test('redirects to Welcome when the archived workspace is the active one', async () => {
	const { view } = renderArchiveAction('san-antonio');

	await act(async () => {
		await view.result.current('san-antonio');
	});

	expect(navigate).toHaveBeenCalledWith({ replace: true, to: '/' });
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
	expect(invalidate).toHaveBeenCalledTimes(1);
});

test('leaves navigation untouched when a background workspace is archived', async () => {
	const { view, disableProjectReorderLayoutAnimation } =
		renderArchiveAction('san-antonio');

	await act(async () => {
		await view.result.current('some-other-workspace');
	});

	expect(navigate).not.toHaveBeenCalled();
	expect(disableProjectReorderLayoutAnimation).toHaveBeenCalledTimes(1);
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
	expect(invalidate).toHaveBeenCalledTimes(1);
});

test('still refreshes list views when there is no active workspace', async () => {
	const { view } = renderArchiveAction(null);

	await act(async () => {
		await view.result.current('san-antonio');
	});

	expect(navigate).not.toHaveBeenCalled();
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
});
