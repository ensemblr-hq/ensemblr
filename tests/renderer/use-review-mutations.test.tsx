// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const {
	navigate,
	invalidate,
	archiveWorkspace,
	invalidateWorkspaceListViews,
	mergePullRequest,
	refreshPullRequestSnapshot,
} = vi.hoisted(() => ({
	navigate: vi.fn().mockResolvedValue(undefined),
	invalidate: vi.fn().mockResolvedValue(undefined),
	archiveWorkspace: vi.fn(),
	invalidateWorkspaceListViews: vi.fn().mockResolvedValue(undefined),
	mergePullRequest: vi.fn().mockResolvedValue({ merged: true }),
	refreshPullRequestSnapshot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => navigate,
	useRouter: () => ({ invalidate }),
}));

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	archiveWorkspace,
	ensemblrQueryKeys: {
		workspaceGitStatus: (cwd: string) => ['git-status', cwd],
	},
	invalidateWorkspaceListViews,
	mergePullRequest,
	refreshPullRequestSnapshot,
}));

vi.mock('sonner', () => ({
	toast: Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/renderer/state/workspace/open-target-history', () => ({
	deleteLastUsedOpenTarget: vi.fn(),
}));

import { useReviewMutations } from '@/renderer/hooks/workbench-shell/review-actions/use-review-mutations';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

const activeWorkspace = {
	id: 'san-antonio',
	pathLabel: '/tmp/san-antonio',
} as unknown as WorkspaceShellModel;

/**
 * Renders the review mutations hook inside a fresh QueryClient provider so the
 * merge mutation can run, returning the hook result for driving the merge flow.
 */
function renderReviewMutations(archiveAfterMerge: boolean) {
	const client = new QueryClient({
		defaultOptions: { mutations: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	return renderHook(
		() =>
			useReviewMutations({
				activeWorkspace,
				mergeSettings: {
					archiveAfterMerge,
					deleteLocalBranchOnArchive: false,
					setUpstreamOnPush: false,
				},
				onSettled: vi.fn(),
			}),
		{ wrapper },
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mergePullRequest.mockResolvedValue({ merged: true });
});

test('redirects to Welcome and refreshes list views after archive-on-merge', async () => {
	archiveWorkspace.mockResolvedValue({ status: 'success' });
	const { result } = renderReviewMutations(true);

	await result.current.mergeMutation.mutateAsync();

	await waitFor(() => {
		expect(navigate).toHaveBeenCalledWith({ replace: true, to: '/' });
	});
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
	expect(invalidate).toHaveBeenCalledTimes(1);
});

test('refreshes list views but stays put when the workspace is not archived', async () => {
	archiveWorkspace.mockResolvedValue({
		status: 'skipped',
		diagnostics: [{ message: 'dirty tree' }],
	});
	const { result } = renderReviewMutations(true);

	await result.current.mergeMutation.mutateAsync();

	await waitFor(() => {
		expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
	});
	expect(navigate).not.toHaveBeenCalled();
});

test('refreshes list views but stays put when archiving throws', async () => {
	archiveWorkspace.mockRejectedValue(new Error('boom'));
	const { result } = renderReviewMutations(true);

	await result.current.mergeMutation.mutateAsync();

	await waitFor(() => {
		expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
	});
	expect(navigate).not.toHaveBeenCalled();
});
