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
	navigate,
	removeWorkspace,
	resolveSettings,
	routerInvalidate,
	toast,
	unarchiveWorkspace,
} = vi.hoisted(() => ({
	archiveWorkspace: vi.fn(),
	getWorkspaceGitStatus: vi.fn(),
	invalidateWorkspaceListViews: vi.fn().mockResolvedValue(undefined),
	navigate: vi.fn().mockResolvedValue(undefined),
	removeWorkspace: {
		archived: vi.fn().mockResolvedValue(undefined),
		deleted: vi.fn().mockResolvedValue(undefined),
	},
	resolveSettings: vi.fn(),
	routerInvalidate: vi.fn().mockResolvedValue(undefined),
	toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
	unarchiveWorkspace: vi.fn(),
}));

/** Where the shell stands when a case starts: the hop restores to this href. */
const RETURN_HREF = '/projects/repo-doomed/workspaces/ws-active/chats/chat-1';

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => navigate,
	useRouter: () => ({
		invalidate: routerInvalidate,
		state: { location: { href: RETURN_HREF } },
	}),
}));

vi.mock('sonner', () => ({ toast }));

// The action takes the hop-aware removal, which is what adds back the one
// `router.invalidate()` the hop's redirect spent — asserted directly in
// `use-remove-workspace-action.test.tsx` rather than through this double.
vi.mock('@/renderer/hooks/workbench-shell/use-remove-workspace-action', () => ({
	useRemoveHoppedWorkspaceAction: () => removeWorkspace,
	useRemoveWorkspaceAction: () => removeWorkspace,
}));

// The archive action reaches the archiving mark through the workspace-state
// barrel, which pulls the shared query client in with it — so the mock has to
// carry the key factory that module reads at import time.
vi.mock('@/renderer/api/ensemblr-queries', () => ({
	archiveWorkspace,
	ensemblrQueryKeys: {
		agentModels: () => ['agent-models'],
		health: () => ['health'],
		repositoryWorkspaceNavigation: () => ['repository-workspace-navigation'],
		reviewComments: (workspaceId: string) => ['review-comments', workspaceId],
		workspaceOpenTargets: () => ['workspace-open-targets'],
	},
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
import { workspaceLifecycleRunsAtom } from '../../src/renderer/state/workspace/workspace-lifecycle-runs';
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
}: {
	deleteLocalBranchOnArchive?: boolean;
} = {}) {
	return { deleteLocalBranchOnArchive };
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

test('keeps the branch on the unconfirmed path', async () => {
	const { view } = mountAction();

	await act(async () => {
		await view.result.current(workspace('ws-reclaim'));
	});

	expect(archiveWorkspace).toHaveBeenCalledWith({
		branchCleanup: false,
		workspaceId: 'ws-reclaim',
	});
});

// The measurement is the only report the user gets that archiving gave the disk
// back, so it has to survive the trip from the IPC result into the toast.
test('reports the disk the archive freed in the success toast', async () => {
	archiveWorkspace.mockResolvedValue({
		archiveRecordId: 'record-1',
		diagnostics: [],
		status: 'success',
		workspace: { bytesFreed: 1_200_000_000 },
	});
	const { view } = mountAction();

	await act(async () => {
		await view.result.current(workspace('ws-freed'));
	});

	expect(toast.success).toHaveBeenCalledWith(
		expect.any(String),
		expect.objectContaining({ description: expect.stringContaining('1.2') }),
	);
});

// `du` is best-effort, and a measurement that did not complete is not news the
// user can act on — the toast says nothing about size rather than "0 bytes".
test('omits the size when the archive could not measure it', async () => {
	const { view } = mountAction();

	await act(async () => {
		await view.result.current(workspace('ws-unmeasured'));
	});

	expect(toast.success).toHaveBeenCalledWith(
		expect.any(String),
		expect.objectContaining({ description: undefined }),
	);
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
		view.result.current({
			branchCleanup: true,
			bytesFreed: null,
			workspaceId: 'ws-dropped',
		});
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

// The row goes non-interactive on the first click, but the Workspace menu and a
// keyboard-repeated click can still land a second one, so it reports rather than
// no-opping in silence.
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

test('marks the workspace archiving for the whole run, and clears it after', async () => {
	let finishArchive: () => void = () => undefined;
	archiveWorkspace.mockReturnValue(
		new Promise((resolve) => {
			finishArchive = () =>
				resolve({
					archiveRecordId: 'record-1',
					diagnostics: [],
					status: 'success',
					workspace: null,
				});
		}),
	);
	const { store, view } = mountAction();
	const target = workspace('ws-marked');

	let run: Promise<void> = Promise.resolve();
	await act(async () => {
		run = view.result.current(target);
	});

	expect(store.get(workspaceLifecycleRunsAtom).has('ws-marked')).toBe(true);

	// The mark has to outlive the removal, or the row flashes back to normal for
	// the frames between the IPC answering and the list dropping it.
	removeWorkspace.archived.mockImplementationOnce(async () => {
		expect(store.get(workspaceLifecycleRunsAtom).has('ws-marked')).toBe(true);
	});

	await act(async () => {
		finishArchive();
		await run;
	});

	expect(store.get(workspaceLifecycleRunsAtom).has('ws-marked')).toBe(false);
});

test('clears the mark when the run escalates to the dialog', async () => {
	getWorkspaceGitStatus.mockResolvedValue(gitStatus(2));
	const { store, view } = mountAction();

	await act(async () => {
		await view.result.current(workspace('ws-escalated'));
	});

	expect(store.get(workspaceLifecycleRunsAtom).has('ws-escalated')).toBe(false);
});

test('clears the mark when the archive fails', async () => {
	archiveWorkspace.mockRejectedValue(new Error('main process is wedged'));
	const { store, view } = mountAction();

	await act(async () => {
		await view.result.current(workspace('ws-failed'));
	});

	expect(store.get(workspaceLifecycleRunsAtom).has('ws-failed')).toBe(false);
});

// Archiving tears the worktree down under the user, so they leave before it
// happens rather than after the IPC answers.
test('leaves the active workspace before running the archive', async () => {
	const { view } = mountAction('ws-active');

	await act(async () => {
		await view.result.current(workspace('ws-active'));
	});

	expect(navigate).toHaveBeenCalledWith({ replace: true, to: '/' });
	expect(navigate.mock.invocationCallOrder[0]).toBeLessThan(
		archiveWorkspace.mock.invocationCallOrder[0] as number,
	);
	// A successful archive removed the workspace, so there is nothing to go back to.
	expect(navigate).toHaveBeenCalledTimes(1);
});

test('stays put when archiving a workspace the user is not in', async () => {
	const { view } = mountAction('ws-elsewhere');

	await act(async () => {
		await view.result.current(workspace('ws-background'));
	});

	expect(navigate).not.toHaveBeenCalled();
});

// Main refuses a vetoed archive before it tears anything down, so the workspace
// the user was hopped out of is still whole. Leaving them in a sibling with only
// a toast to explain it would cost them their place for nothing.
test('returns the user to the workspace when a hook vetoes the archive', async () => {
	archiveWorkspace.mockResolvedValue({
		archiveRecordId: null,
		diagnostics: [],
		status: 'aborted',
	});
	const { view } = mountAction('ws-active');

	await act(async () => {
		await view.result.current(workspace('ws-active'));
	});

	expect(navigate).toHaveBeenNthCalledWith(1, { replace: true, to: '/' });
	expect(navigate).toHaveBeenNthCalledWith(2, {
		href: RETURN_HREF,
		replace: true,
	});
	expect(removeWorkspace.archived).not.toHaveBeenCalled();
	expect(toast.warning).toHaveBeenCalledTimes(1);
});

test('returns the user to the workspace when the archive fails outright', async () => {
	archiveWorkspace.mockRejectedValue(new Error('main process is wedged'));
	const { view } = mountAction('ws-active');

	await act(async () => {
		await view.result.current(workspace('ws-active'));
	});

	expect(navigate).toHaveBeenNthCalledWith(2, {
		href: RETURN_HREF,
		replace: true,
	});
	expect(toast.error).toHaveBeenCalledTimes(1);
});

// The user asked for the archive. Standing in the wrong place while it runs
// beats the click doing nothing at all with nothing on screen to say why.
test('archives anyway when the hop out cannot be made', async () => {
	navigate.mockRejectedValueOnce(new Error('router is wedged'));
	const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	const { view } = mountAction('ws-active');

	await act(async () => {
		await view.result.current(workspace('ws-active'));
	});

	expect(archiveWorkspace).toHaveBeenCalledTimes(1);
	expect(removeWorkspace.archived).toHaveBeenCalledWith('ws-active');
	// Nothing moved, so there is nothing to move back.
	expect(navigate).toHaveBeenCalledTimes(1);
	logged.mockRestore();
});
