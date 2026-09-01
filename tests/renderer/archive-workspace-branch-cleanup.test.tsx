// @vitest-environment happy-dom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArchiveWorkspaceDialog } from '@/renderer/components/workbench-shell/archive-workspace-dialog';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

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

/**
 * Installs a bridge whose settings resolver reports the repository's worktree
 * disposal policy, plus a spy standing in for the archive IPC.
 */
function installBridge({
	deleteLocalBranchOnArchive,
	reclaimDiskOnArchive,
	resolveSettings,
}: {
	deleteLocalBranchOnArchive?: boolean;
	reclaimDiskOnArchive?: boolean;
	resolveSettings?: () => Promise<unknown>;
}): ReturnType<typeof vi.fn> {
	const archiveWorkspace = vi.fn(() =>
		Promise.resolve({ diagnostics: [], status: 'success' }),
	);
	installEnsemblrApi({
		archiveWorkspace,
		resolveSettings:
			resolveSettings ??
			(() =>
				Promise.resolve({
					repository: {
						settings: [
							{
								key: 'deleteLocalBranchOnArchive',
								source: 'default',
								value: deleteLocalBranchOnArchive === true,
							},
							{
								key: 'reclaimDiskOnArchive',
								source: 'default',
								value: reclaimDiskOnArchive === true,
							},
						],
					},
				})),
	});
	return archiveWorkspace;
}

/** Renders the dialog against a workspace that owns a branch. */
function renderDialog(): void {
	renderWithProviders(
		<ArchiveWorkspaceDialog
			onArchived={vi.fn()}
			onOpenChange={vi.fn()}
			open={true}
			workspace={workspace()}
		/>,
	);
}

describe('archive workspace dialog branch cleanup', () => {
	afterEach(() => {
		clearEnsemblrApi();
	});

	it('archives without branch cleanup when the git setting is off', async () => {
		const archiveWorkspace = installBridge({
			deleteLocalBranchOnArchive: false,
		});

		renderDialog();

		const action = screen.getByRole('button', { name: /^archive$/i });
		await waitFor(() => {
			expect(action).not.toBeDisabled();
		});
		await userEvent.click(action);

		await waitFor(() => {
			expect(archiveWorkspace).toHaveBeenCalledWith({
				branchCleanup: false,
				reclaimDisk: false,
				workspaceId: 'ws-doomed',
			});
		});
	});

	it('archives with branch cleanup when the git setting is on', async () => {
		const archiveWorkspace = installBridge({
			deleteLocalBranchOnArchive: true,
		});

		renderDialog();

		const action = screen.getByRole('button', { name: /^archive$/i });
		await waitFor(() => {
			expect(action).not.toBeDisabled();
		});
		await userEvent.click(action);

		await waitFor(() => {
			expect(archiveWorkspace).toHaveBeenCalledWith({
				branchCleanup: true,
				reclaimDisk: false,
				workspaceId: 'ws-doomed',
			});
		});
	});

	// A pending resolver reads as `false`, so archiving before it answers would
	// silently skip the cleanup the setting asked for.
	it('disables the archive button until the settings resolver answers', async () => {
		const settingsGate: { release: () => void } = { release: () => {} };
		const archiveWorkspace = installBridge({
			resolveSettings: () =>
				new Promise((resolve) => {
					settingsGate.release = () =>
						resolve({
							repository: {
								settings: [
									{
										key: 'deleteLocalBranchOnArchive',
										source: 'default',
										value: true,
									},
								],
							},
						});
				}),
		});

		renderDialog();

		const action = screen.getByRole('button', { name: /^archive$/i });
		expect(action).toBeDisabled();

		await userEvent.click(action);
		expect(archiveWorkspace).not.toHaveBeenCalled();

		settingsGate.release();

		await waitFor(() => {
			expect(action).not.toBeDisabled();
		});
	});

	it('archives with disk reclaim when only that git setting is on', async () => {
		const archiveWorkspace = installBridge({ reclaimDiskOnArchive: true });

		renderDialog();

		const action = screen.getByRole('button', { name: /^archive$/i });
		await waitFor(() => {
			expect(action).not.toBeDisabled();
		});
		await userEvent.click(action);

		await waitFor(() => {
			expect(archiveWorkspace).toHaveBeenCalledWith({
				branchCleanup: false,
				reclaimDisk: true,
				workspaceId: 'ws-doomed',
			});
		});
	});

	// Dropping the branch destroys the commits; reclaiming keeps them. Sending
	// both would let the dialog promise a workspace that comes back while doing
	// the archive that does not.
	it('does not reclaim when branch cleanup already destroys the worktree', async () => {
		const archiveWorkspace = installBridge({
			deleteLocalBranchOnArchive: true,
			reclaimDiskOnArchive: true,
		});

		renderDialog();

		const action = screen.getByRole('button', { name: /^archive$/i });
		await waitFor(() => {
			expect(action).not.toBeDisabled();
		});
		await userEvent.click(action);

		await waitFor(() => {
			expect(archiveWorkspace).toHaveBeenCalledWith({
				branchCleanup: true,
				reclaimDisk: false,
				workspaceId: 'ws-doomed',
			});
		});
	});

	// A failed resolver reads as `false` too, so without the notice the dialog
	// would quietly do the opposite of a repository that opted into cleanup.
	it('says the branch is kept when the settings resolver fails', async () => {
		const archiveWorkspace = installBridge({
			resolveSettings: () => Promise.reject(new Error('resolver unavailable')),
		});

		renderDialog();

		expect(
			await screen.findByTestId('archive-workspace-settings-error'),
		).toBeTruthy();

		const action = screen.getByRole('button', { name: /^archive$/i });
		await waitFor(() => {
			expect(action).not.toBeDisabled();
		});
		await userEvent.click(action);

		await waitFor(() => {
			expect(archiveWorkspace).toHaveBeenCalledWith({
				branchCleanup: false,
				reclaimDisk: false,
				workspaceId: 'ws-doomed',
			});
		});
	});
});
