// @vitest-environment happy-dom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { navigate, routerInvalidate } = vi.hoisted(() => ({
	navigate: vi.fn().mockResolvedValue(undefined),
	routerInvalidate: vi.fn().mockResolvedValue(undefined),
}));

/** Where the shell stands when a case starts: the hop restores to this href. */
const RETURN_HREF = '/projects/repo-doomed/workspaces/ws-doomed/chats/chat-1';

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => navigate,
	useRouter: () => ({
		invalidate: routerInvalidate,
		state: { location: { href: RETURN_HREF } },
	}),
}));

import { ArchiveWorkspaceDialog } from '@/renderer/components/workbench-shell/archive-workspace-dialog';
import { workspaceLifecycleRunsAtom } from '@/renderer/state/workspace/workspace-lifecycle-runs';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

const store = getDefaultStore();

/** Minimal workspace shell model the archive dialog reads. */
function workspace(): WorkspaceShellModel {
	return {
		branchName: 'feature/doomed',
		changeSummary: { additions: 0, deletions: 0, files: 0 },
		id: 'ws-doomed',
		name: 'doomed',
		pathLabel: '/tmp/ws-doomed',
		projectId: 'repo-doomed',
		pullRequest: {},
		sessions: [],
		workspaceFiles: [],
	} as unknown as WorkspaceShellModel;
}

/** Installs a bridge whose archive IPC answers with the given status. */
function installBridge(
	archiveWorkspace: ReturnType<typeof vi.fn>,
	uncommittedFiles = 3,
): void {
	installEnsemblrApi({
		archiveWorkspace,
		getWorkspaceGitStatus: () =>
			Promise.resolve({
				files: [],
				summary: { additions: 0, deletions: 0, files: uncommittedFiles },
			}),
		resolveSettings: () =>
			Promise.resolve({
				repository: {
					settings: [
						{
							key: 'deleteLocalBranchOnArchive',
							source: 'default',
							value: false,
						},
					],
				},
			}),
	});
}

/** Renders the dialog with the user standing in the workspace it archives. */
function renderDialog(onArchived = vi.fn()): void {
	renderWithProviders(
		<ArchiveWorkspaceDialog
			activeWorkspaceId='ws-doomed'
			onArchived={onArchived}
			onOpenChange={vi.fn()}
			open={true}
			workspace={workspace()}
		/>,
	);
}

/** Clicks the dialog's Archive button once it is live. */
async function confirmArchive(): Promise<void> {
	const action = await screen.findByRole('button', { name: 'Archive' });
	await waitFor(() => {
		expect(action).toBeEnabled();
	});
	await userEvent.click(action);
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	clearEnsemblrApi();
	store.set(workspaceLifecycleRunsAtom, new Map());
});

// A confirmed archive is the same run as an unconfirmed one, and it is the
// slower of the two: these are the worktrees carrying uncommitted work. It has
// to carry the same live state, or the sidebar row shows its branch while the
// worktree it names is being taken apart.
describe('archive workspace dialog live state', () => {
	it('marks the workspace archiving for the whole run', async () => {
		let finishArchive: () => void = () => undefined;
		const archiveWorkspace = vi.fn(
			() =>
				new Promise((resolve) => {
					finishArchive = () =>
						resolve({
							archiveRecordId: 'record-1',
							diagnostics: [],
							status: 'success',
						});
				}),
		);
		installBridge(archiveWorkspace);
		const onArchived = vi.fn(() => {
			expect(store.get(workspaceLifecycleRunsAtom).has('ws-doomed')).toBe(true);
		});
		renderDialog(onArchived);

		await confirmArchive();
		await waitFor(() => {
			expect(archiveWorkspace).toHaveBeenCalledTimes(1);
		});
		expect(store.get(workspaceLifecycleRunsAtom).has('ws-doomed')).toBe(true);

		finishArchive();
		await waitFor(() => {
			expect(store.get(workspaceLifecycleRunsAtom).has('ws-doomed')).toBe(
				false,
			);
		});
		expect(onArchived).toHaveBeenCalledTimes(1);
	});

	it('leaves the workspace before the teardown starts', async () => {
		const archiveWorkspace = vi.fn(() =>
			Promise.resolve({
				archiveRecordId: 'record-1',
				diagnostics: [],
				status: 'success',
			}),
		);
		installBridge(archiveWorkspace);
		renderDialog();

		await confirmArchive();
		await waitFor(() => {
			expect(archiveWorkspace).toHaveBeenCalledTimes(1);
		});

		expect(navigate).toHaveBeenCalledWith({ replace: true, to: '/' });
		expect(navigate.mock.invocationCallOrder[0]).toBeLessThan(
			archiveWorkspace.mock.invocationCallOrder[0] as number,
		);
	});

	it('returns the user when a hook vetoes the archive', async () => {
		const archiveWorkspace = vi.fn(() =>
			Promise.resolve({
				archiveRecordId: null,
				diagnostics: [
					{
						code: 'archive-aborted-by-hook',
						message: 'unpushed work',
						severity: 'error',
					},
				],
				status: 'aborted',
			}),
		);
		installBridge(archiveWorkspace);
		const onArchived = vi.fn();
		renderDialog(onArchived);

		await confirmArchive();
		await waitFor(() => {
			expect(navigate).toHaveBeenCalledTimes(2);
		});

		expect(navigate).toHaveBeenNthCalledWith(1, { replace: true, to: '/' });
		expect(navigate).toHaveBeenNthCalledWith(2, {
			href: RETURN_HREF,
			replace: true,
		});
		expect(onArchived).not.toHaveBeenCalled();
		expect(store.get(workspaceLifecycleRunsAtom).has('ws-doomed')).toBe(false);
	});
});
