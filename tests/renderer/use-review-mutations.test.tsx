// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const {
	archiveWorkspace,
	continueWorkspaceBranch,
	invalidateWorkspaceGitStatus,
	invalidateWorkspaceListViews,
	mergePullRequest,
	pushWorkspaceBranch,
	refreshPullRequestSnapshot,
	removeWorkspace,
} = vi.hoisted(() => ({
	archiveWorkspace: vi.fn(),
	continueWorkspaceBranch: vi.fn(),
	invalidateWorkspaceGitStatus: vi.fn().mockResolvedValue(undefined),
	invalidateWorkspaceListViews: vi.fn().mockResolvedValue(undefined),
	mergePullRequest: vi.fn().mockResolvedValue({ merged: true }),
	pushWorkspaceBranch: vi.fn().mockResolvedValue({ ok: true }),
	refreshPullRequestSnapshot: vi.fn().mockResolvedValue(undefined),
	removeWorkspace: {
		archived: vi.fn().mockResolvedValue(undefined),
		deleted: vi.fn().mockResolvedValue(undefined),
	},
}));

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	archiveWorkspace,
	continueWorkspaceBranch,
	invalidateWorkspaceGitStatus,
	invalidateWorkspaceListViews,
	mergePullRequest,
	pushWorkspaceBranch,
	refreshPullRequestSnapshot,
}));

vi.mock('sonner', () => ({
	toast: Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/renderer/hooks/workbench-shell/use-remove-workspace-action', () => ({
	useRemoveWorkspaceAction: () => removeWorkspace,
}));

vi.mock('@/renderer/state/workspace', async () => {
	const { continuedMergedPullRequestByWorkspaceAtom } = await import(
		'../../src/renderer/state/workspace/layout-atoms'
	);
	const { useWorkspaceLifecycleRun, useWorkspaceLifecycleRunActions } =
		await import('../../src/renderer/state/workspace/workspace-lifecycle-runs');
	return {
		continuedMergedPullRequestByWorkspaceAtom,
		useWorkspaceLifecycleRun,
		useWorkspaceLifecycleRunActions,
	};
});

import { toast } from 'sonner';

import { useReviewMutations } from '../../src/renderer/hooks/workbench-shell/review-actions/use-review-mutations';
import { workspaceLifecycleRunsAtom } from '../../src/renderer/state/workspace/workspace-lifecycle-runs';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';

const activeWorkspace = {
	id: 'san-antonio',
	pathLabel: '/tmp/san-antonio',
	pullRequest: { number: 7 },
} as unknown as WorkspaceShellModel;

const otherWorkspace = {
	id: 'houston',
	pathLabel: '/tmp/houston',
	pullRequest: { number: 9 },
} as unknown as WorkspaceShellModel;

/**
 * Renders the review mutations hook inside a QueryClient provider so the
 * mutations can run, returning the hook result for driving the review flow.
 * The rendered workspace is a prop so a test can switch the shell onto another
 * one while a run is still in flight. Passing the `client` of an earlier render
 * models a remount of the same app rather than a second app, which is what the
 * shell does when the user navigates to Welcome and back mid-run.
 */
function renderReviewMutations(
	archiveAfterMerge: boolean,
	client = new QueryClient({
		defaultOptions: { mutations: { retry: false } },
	}),
) {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const rendered = renderHook(
		({ workspace }: { workspace: WorkspaceShellModel }) =>
			useReviewMutations({
				activeWorkspace: workspace,
				mergeSettings: {
					archiveAfterMerge,
					deleteLocalBranchOnArchive: false,
					setUpstreamOnPush: false,
				},
				onSettled: vi.fn(),
			}),
		{ initialProps: { workspace: activeWorkspace }, wrapper },
	);
	return { ...rendered, client };
}

/** A promise plus the resolver a test uses to hold an IPC open. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

beforeEach(() => {
	vi.clearAllMocks();
	mergePullRequest.mockResolvedValue({ merged: true });
	pushWorkspaceBranch.mockResolvedValue({ ok: true });
	getDefaultStore().set(workspaceLifecycleRunsAtom, new Map());
});

/** Resolves a continue IPC with the shape the success path expects. */
function continueSucceeded(branchName: string) {
	return { branchName, diagnostics: [], status: 'success' };
}

test('does not show a merge-completed toast when archive-on-merge is disabled', async () => {
	const { result } = renderReviewMutations(false);

	act(() => {
		result.current.merge();
	});

	await waitFor(() => {
		expect(refreshPullRequestSnapshot).toHaveBeenCalled();
	});
	expect(toast.success).not.toHaveBeenCalled();
});

test('uses the shared removal action after archiving a merged workspace', async () => {
	archiveWorkspace.mockResolvedValue({ status: 'success' });
	const { result } = renderReviewMutations(true);

	act(() => {
		result.current.archiveMergedWorkspace();
	});

	await waitFor(() => {
		expect(removeWorkspace.archived).toHaveBeenCalledWith('san-antonio');
	});
	expect(removeWorkspace.deleted).not.toHaveBeenCalled();
});

test('refreshes list views but stays put when the workspace is not archived', async () => {
	archiveWorkspace.mockResolvedValue({
		status: 'skipped',
		diagnostics: [{ message: 'dirty tree' }],
	});
	const { result } = renderReviewMutations(true);

	act(() => {
		result.current.merge();
	});

	await waitFor(() => {
		expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
	});
	expect(removeWorkspace.archived).not.toHaveBeenCalled();
});

test('refreshes list views but stays put when archiving throws', async () => {
	archiveWorkspace.mockRejectedValue(new Error('boom'));
	const { result } = renderReviewMutations(true);

	act(() => {
		result.current.merge();
	});

	await waitFor(() => {
		expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
	});
	expect(removeWorkspace.archived).not.toHaveBeenCalled();
});

test('refreshes the change set at every diff scope after a merge', async () => {
	const { result } = renderReviewMutations(false);

	act(() => {
		result.current.merge();
	});

	await waitFor(() => {
		expect(invalidateWorkspaceGitStatus).toHaveBeenCalledWith(
			expect.anything(),
			'/tmp/san-antonio',
		);
	});
});

test('leaves the archive busy flag off a workspace that is not the one archiving', async () => {
	const archiveGate = deferred<{ status: string }>();
	archiveWorkspace.mockReturnValue(archiveGate.promise);
	const { rerender, result } = renderReviewMutations(true);

	act(() => {
		result.current.archiveMergedWorkspace();
	});
	await waitFor(() => {
		expect(result.current.isArchivingMergedWorkspace).toBe(true);
	});

	rerender({ workspace: otherWorkspace });
	expect(result.current.isArchivingMergedWorkspace).toBe(false);

	await act(async () => {
		archiveGate.resolve({ status: 'success' });
		await archiveGate.promise;
	});
	await waitFor(() => {
		expect(result.current.isArchivingMergedWorkspace).toBe(false);
	});
});

test('archives the workspace the run started on after the shell moved to another', async () => {
	const archiveGate = deferred<{ status: string }>();
	archiveWorkspace.mockReturnValue(archiveGate.promise);
	const { rerender, result } = renderReviewMutations(true);

	act(() => {
		result.current.archiveMergedWorkspace();
	});
	rerender({ workspace: otherWorkspace });
	await act(async () => {
		archiveGate.resolve({ status: 'success' });
		await archiveGate.promise;
	});

	await waitFor(() => {
		expect(removeWorkspace.archived).toHaveBeenCalledWith('san-antonio');
	});
});

test('keeps the archive busy flag on across a shell unmount and remount', async () => {
	const archiveGate = deferred<{ status: string }>();
	archiveWorkspace.mockReturnValue(archiveGate.promise);
	const first = renderReviewMutations(true);

	act(() => {
		first.result.current.archiveMergedWorkspace();
	});
	await waitFor(() => {
		expect(first.result.current.isArchivingMergedWorkspace).toBe(true);
	});

	first.unmount();
	const second = renderReviewMutations(true, first.client);
	expect(second.result.current.isArchivingMergedWorkspace).toBe(true);

	await act(async () => {
		archiveGate.resolve({ status: 'success' });
		await archiveGate.promise;
	});
	await waitFor(() => {
		expect(second.result.current.isArchivingMergedWorkspace).toBe(false);
	});
});

test('leaves the continue busy flag off a workspace that is not the one continuing', async () => {
	const continueGate = deferred<ReturnType<typeof continueSucceeded>>();
	continueWorkspaceBranch.mockReturnValue(continueGate.promise);
	const { rerender, result } = renderReviewMutations(false);

	act(() => {
		result.current.continueMergedWorkspace();
	});
	await waitFor(() => {
		expect(result.current.isContinuingMergedWorkspace).toBe(true);
	});

	rerender({ workspace: otherWorkspace });
	expect(result.current.isContinuingMergedWorkspace).toBe(false);

	await act(async () => {
		continueGate.resolve(continueSucceeded('next'));
		await continueGate.promise;
	});
	await waitFor(() => {
		expect(refreshPullRequestSnapshot).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceId: 'san-antonio' }),
		);
	});
});

test('keeps the continue busy flag on across a shell unmount and remount', async () => {
	const continueGate = deferred<ReturnType<typeof continueSucceeded>>();
	continueWorkspaceBranch.mockReturnValue(continueGate.promise);
	const first = renderReviewMutations(false);

	act(() => {
		first.result.current.continueMergedWorkspace();
	});
	await waitFor(() => {
		expect(first.result.current.isContinuingMergedWorkspace).toBe(true);
	});

	first.unmount();
	const second = renderReviewMutations(false, first.client);
	expect(second.result.current.isContinuingMergedWorkspace).toBe(true);

	await act(async () => {
		continueGate.resolve(continueSucceeded('next'));
		await continueGate.promise;
	});
	await waitFor(() => {
		expect(second.result.current.isContinuingMergedWorkspace).toBe(false);
	});
});

test('leaves the push busy flag off a workspace that is not the one pushing', async () => {
	const pushGate = deferred<{ ok: boolean }>();
	pushWorkspaceBranch.mockReturnValue(pushGate.promise);
	const { rerender, result } = renderReviewMutations(false);

	act(() => {
		result.current.pushBranch();
	});
	await waitFor(() => {
		expect(result.current.isPushingBranch).toBe(true);
	});

	rerender({ workspace: otherWorkspace });
	expect(result.current.isPushingBranch).toBe(false);

	await act(async () => {
		pushGate.resolve({ ok: true });
		await pushGate.promise;
	});
	await waitFor(() => {
		expect(refreshPullRequestSnapshot).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceId: 'san-antonio' }),
		);
	});
});

test('archives the workspace the merge ran against, not the one now on screen', async () => {
	const mergeGate = deferred<{ merged: boolean }>();
	mergePullRequest.mockReturnValue(mergeGate.promise);
	archiveWorkspace.mockResolvedValue({ status: 'success' });
	const { rerender, result } = renderReviewMutations(true);

	act(() => {
		result.current.merge();
	});
	rerender({ workspace: otherWorkspace });
	await act(async () => {
		mergeGate.resolve({ merged: true });
		await mergeGate.promise;
	});

	await waitFor(() => {
		expect(removeWorkspace.archived).toHaveBeenCalledWith('san-antonio');
	});
	expect(archiveWorkspace).toHaveBeenCalledWith(
		expect.objectContaining({ workspaceId: 'san-antonio' }),
	);
});

test('keeps the continue busy flag on while a second workspace continues too', async () => {
	const firstGate = deferred<ReturnType<typeof continueSucceeded>>();
	const secondGate = deferred<ReturnType<typeof continueSucceeded>>();
	continueWorkspaceBranch
		.mockReturnValueOnce(firstGate.promise)
		.mockReturnValueOnce(secondGate.promise);
	const { rerender, result } = renderReviewMutations(false);

	act(() => {
		result.current.continueMergedWorkspace();
	});
	await waitFor(() => {
		expect(result.current.isContinuingMergedWorkspace).toBe(true);
	});

	rerender({ workspace: otherWorkspace });
	act(() => {
		result.current.continueMergedWorkspace();
	});
	await waitFor(() => {
		expect(result.current.isContinuingMergedWorkspace).toBe(true);
	});

	rerender({ workspace: activeWorkspace });
	expect(result.current.isContinuingMergedWorkspace).toBe(true);

	await act(async () => {
		firstGate.resolve(continueSucceeded('next'));
		secondGate.resolve(continueSucceeded('next'));
		await Promise.all([firstGate.promise, secondGate.promise]);
	});
	await waitFor(() => {
		expect(result.current.isContinuingMergedWorkspace).toBe(false);
	});
});
