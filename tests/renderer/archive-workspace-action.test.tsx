// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const {
	archiveWorkspace,
	getWorkspaceGitStatus,
	invalidateWorkspaceListViews,
	removeWorkspace,
	resolveSettings,
	routerInvalidate,
	toast,
	unarchiveWorkspace,
} = vi.hoisted(() => ({
	archiveWorkspace: vi.fn(),
	getWorkspaceGitStatus: vi.fn(),
	invalidateWorkspaceListViews: vi.fn().mockResolvedValue(undefined),
	removeWorkspace: {
		archived: vi.fn().mockResolvedValue(undefined),
		deleted: vi.fn().mockResolvedValue(undefined),
	},
	resolveSettings: vi.fn(),
	routerInvalidate: vi.fn().mockResolvedValue(undefined),
	toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
	unarchiveWorkspace: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
	useRouter: () => ({ invalidate: routerInvalidate }),
}));

vi.mock('sonner', () => ({ toast }));

vi.mock('@/renderer/hooks/workbench-shell/use-remove-workspace-action', () => ({
	useRemoveWorkspaceAction: () => removeWorkspace,
}));

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	archiveWorkspace,
	invalidateWorkspaceListViews,
	reviewMergeSettingsQuery: () => ({
		queryFn: resolveSettings,
		queryKey: ['review-merge-settings'],
	}),
	unarchiveWorkspace,
	workspaceGitStatusQuery: () => ({
		queryFn: getWorkspaceGitStatus,
		queryKey: ['workspace-git-status'],
	}),
}));

import {
	useArchivedWorkspaceToast,
	useArchiveWorkspaceAction,
} from '../../src/renderer/hooks/workbench-shell/use-archive-workspace-action';
import { workspaceLifecycleDialogAtom } from '../../src/renderer/state/dialogs';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';

/** Minimal workspace shell model the archive action reads. */
function workspace(id: string): WorkspaceShellModel {
	return {
		branchName: 'feature/doomed',
		id,
		name: 'doomed',
		pathLabel: `/tmp/${id}`,
		projectId: 'repo-doomed',
	} as unknown as WorkspaceShellModel;
}

/** Git status the resolver reads: `files` is the uncommitted count that gates the dialog. */
function gitStatus(files: number, error?: unknown) {
	return { error, files: [], summary: { additions: 0, deletions: 0, files } };
}

/** Repository git settings, in the resolver's raw `resolveSettings` shape. */
function gitSettings({
	deleteLocalBranchOnArchive = false,
	reclaimDiskOnArchive = true,
}: {
	deleteLocalBranchOnArchive?: boolean;
	reclaimDiskOnArchive?: boolean;
} = {}) {
	return { deleteLocalBranchOnArchive, reclaimDiskOnArchive };
}

/** Mounts a hook against a fresh query cache and jotai store the test can read back. */
function mountHook<TResult>(hook: () => TResult) {
	const store = createStore();
	const client = new QueryClient({
		defaultOptions: { queries: { gcTime: 0, retry: false } },
	});
	const view = renderHook(hook, {
		wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>
				<Provider store={store}>{children}</Provider>
			</QueryClientProvider>
		),
	});
	return { store, view };
}

/** Mounts the archive action the workspace menus fire. */
function mountAction(activeWorkspaceId: string | null = null) {
	return mountHook(() => useArchiveWorkspaceAction({ activeWorkspaceId }));
}

beforeEach(() => {
	vi.clearAllMocks();
	getWorkspaceGitStatus.mockResolvedValue(gitStatus(0));
	resolveSettings.mockResolvedValue(gitSettings());
	archiveWorkspace.mockResolvedValue({
		archiveRecordId: 'record-1',
		diagnostics: [],
		status: 'success',
		workspace: null,
	});
	unarchiveWorkspace.mockResolvedValue({
		diagnostics: [],
		status: 'success',
		workspace: null,
	});
});

test('archives a clean workspace without raising the dialog', async () => {
	const { store, view } = mountAction();

	await act(async () => {
		await view.result.current(workspace('ws-clean'));
	});

	expect(archiveWorkspace).toHaveBeenCalledWith({
		branchCleanup: false,
		reclaimDisk: true,
		workspaceId: 'ws-clean',
	});
	expect(removeWorkspace.archived).toHaveBeenCalledWith('ws-clean');
	expect(toast.success).toHaveBeenCalledTimes(1);
	expect(store.get(workspaceLifecycleDialogAtom)).toBeNull();
});

// `git branch -D` takes any commit that never reached the remote with it, and
// unarchiving cuts a fresh branch from base rather than restoring the history —
// so a clean worktree is not enough to run this one unattended.
test('raises the archive dialog when the plan would drop the local branch', async () => {
	resolveSettings.mockResolvedValue(
		gitSettings({ deleteLocalBranchOnArchive: true }),
	);
	const { store, view } = mountAction();
	const target = workspace('ws-cleanup');

	await act(async () => {
		await view.result.current(target);
	});

	expect(archiveWorkspace).not.toHaveBeenCalled();
	expect(store.get(workspaceLifecycleDialogAtom)).toEqual({
		kind: 'archive',
		workspace: target,
	});
});

test('keeps the branch and reclaims the disk on the unconfirmed path', async () => {
	const { view } = mountAction();

	await act(async () => {
		await view.result.current(workspace('ws-reclaim'));
	});

	expect(archiveWorkspace).toHaveBeenCalledWith({
		branchCleanup: false,
		reclaimDisk: true,
		workspaceId: 'ws-reclaim',
	});
});

test('archives without reclaiming when the repository turns that off', async () => {
	resolveSettings.mockResolvedValue(
		gitSettings({ reclaimDiskOnArchive: false }),
	);
	const { view } = mountAction();

	await act(async () => {
		await view.result.current(workspace('ws-keep'));
	});

	expect(archiveWorkspace).toHaveBeenCalledWith({
		branchCleanup: false,
		reclaimDisk: false,
		workspaceId: 'ws-keep',
	});
});

test('raises the archive dialog when the worktree has uncommitted changes', async () => {
	getWorkspaceGitStatus.mockResolvedValue(gitStatus(3));
	const { store, view } = mountAction();
	const target = workspace('ws-dirty');

	await act(async () => {
		await view.result.current(target);
	});

	expect(archiveWorkspace).not.toHaveBeenCalled();
	expect(store.get(workspaceLifecycleDialogAtom)).toEqual({
		kind: 'archive',
		workspace: target,
	});
});

test('raises the archive dialog when git status reports an error', async () => {
	getWorkspaceGitStatus.mockResolvedValue(
		gitStatus(0, { code: 'not-a-repository', message: 'no repo' }),
	);
	const { store, view } = mountAction();

	await act(async () => {
		await view.result.current(workspace('ws-unreadable'));
	});

	expect(archiveWorkspace).not.toHaveBeenCalled();
	expect(store.get(workspaceLifecycleDialogAtom)?.kind).toBe('archive');
});

test('raises the archive dialog when the git status lookup rejects', async () => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	getWorkspaceGitStatus.mockRejectedValue(new Error('bridge is gone'));
	const { store, view } = mountAction();

	await act(async () => {
		await view.result.current(workspace('ws-offline'));
	});

	expect(archiveWorkspace).not.toHaveBeenCalled();
	expect(store.get(workspaceLifecycleDialogAtom)?.kind).toBe('archive');
});

test('undoing the success toast unarchives the workspace', async () => {
	const { view } = mountAction();

	await act(async () => {
		await view.result.current(workspace('ws-undone'));
	});

	const [, options] = toast.success.mock.calls[0] as [
		string,
		{ action: { label: string; onClick: () => void } },
	];
	await act(async () => {
		options.action.onClick();
	});

	expect(unarchiveWorkspace).toHaveBeenCalledWith({
		workspaceId: 'ws-undone',
	});
	expect(routerInvalidate).toHaveBeenCalledTimes(1);
});

// Unarchiving a branch-cleanup archive cuts a fresh branch from base, so the
// workspace comes back without the commits it had. Offering `Undo` for that
// would promise a restore nothing can perform.
test('offers no undo for an archive that dropped the local branch', () => {
	const { view } = mountHook(() => useArchivedWorkspaceToast());

	act(() => {
		view.result.current({ branchCleanup: true, workspaceId: 'ws-dropped' });
	});

	const [, options] = toast.success.mock.calls[0] as [
		string,
		{ action?: unknown; description?: string },
	];
	expect(options.action).toBeUndefined();
	expect(options.description).toBeTruthy();
	expect(unarchiveWorkspace).not.toHaveBeenCalled();
});

test('reports rather than removes when a hook aborts the archive', async () => {
	archiveWorkspace.mockResolvedValue({
		archiveRecordId: null,
		diagnostics: [
			{
				code: 'archive-aborted-by-hook',
				message: 'A pre-archive hook vetoed the run.',
				severity: 'error',
			},
		],
		status: 'aborted',
		workspace: null,
	});
	const { view } = mountAction();

	await act(async () => {
		await view.result.current(workspace('ws-vetoed'));
	});

	expect(removeWorkspace.archived).not.toHaveBeenCalled();
	expect(toast.warning).toHaveBeenCalledTimes(1);
	expect(invalidateWorkspaceListViews).toHaveBeenCalledTimes(1);
});

test('reports a rejected archive IPC instead of announcing a success', async () => {
	archiveWorkspace.mockRejectedValue(new Error('main process is wedged'));
	const { view } = mountAction();

	await act(async () => {
		await view.result.current(workspace('ws-wedged'));
	});

	expect(removeWorkspace.archived).not.toHaveBeenCalled();
	expect(toast.success).not.toHaveBeenCalled();
	expect(toast.error).toHaveBeenCalledTimes(1);
});

test('starts one archive when the action is fired twice in one task', async () => {
	const { view } = mountAction();
	const target = workspace('ws-double');

	await act(async () => {
		await Promise.all([
			view.result.current(target),
			view.result.current(target),
		]);
	});

	expect(archiveWorkspace).toHaveBeenCalledTimes(1);
});

// The action has no busy state of its own, so a silent second click leaves the
// menu item looking dead.
test('reports the second fire rather than no-opping in silence', async () => {
	const { view } = mountAction();
	const target = workspace('ws-double-report');

	await act(async () => {
		await Promise.all([
			view.result.current(target),
			view.result.current(target),
		]);
	});

	expect(toast.warning).toHaveBeenCalledTimes(1);
	expect(toast.warning.mock.calls[0]?.[1]).toEqual({
		id: 'archive-workspace:ws-double-report',
	});
});
