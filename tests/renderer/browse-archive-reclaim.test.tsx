// @vitest-environment happy-dom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowseArchiveDialog } from '@/renderer/components/workbench-shell/browse-archive-dialog';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type { ArchivedWorkspaceListEntry } from '@/shared/ipc/contracts/workspace';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

/** Minimal project shell model the archive browser reads. */
function project(): ProjectShellModel {
	return { id: 'repo-1', name: 'demo' } as unknown as ProjectShellModel;
}

/** One archived row, defaulting to a worktree that still occupies disk. */
function entry(
	overrides: Partial<ArchivedWorkspaceListEntry> = {},
): ArchivedWorkspaceListEntry {
	return {
		archiveRecordId: 'archive-1',
		archivedAt: '2026-06-08T12:00:00.000Z',
		archivedContextPath: null,
		baseBranch: 'main',
		branchCleanup: false,
		branchName: 'octocat/eng-1',
		id: 'ws-1',
		name: 'eng-1',
		path: '/tmp/workspaces/eng-1',
		pathExists: true,
		repositoryId: 'repo-1',
		slug: 'eng-1',
		worktreePruned: false,
		...overrides,
	};
}

/** Installs a bridge listing `entries`, plus a spy standing in for the reclaim IPC. */
function installBridge(
	entries: ArchivedWorkspaceListEntry[],
	result: {
		bytesFreed: number;
		reclaimedCount: number;
	} = { bytesFreed: 1_932_735_283, reclaimedCount: 1 },
): ReturnType<typeof vi.fn> {
	const reclaimArchivedWorkspaceDisk = vi.fn(
		(request: { workspaceIds: string[] }) =>
			Promise.resolve({
				bytesFreed: result.bytesFreed,
				diagnostics: [],
				entries: request.workspaceIds.map((workspaceId) => ({
					bytesFreed: result.bytesFreed,
					diagnostics: [],
					status: 'reclaimed',
					workspaceId,
				})),
				reclaimedCount: result.reclaimedCount,
			}),
	);
	installEnsemblrApi({
		listArchivedWorkspaces: () =>
			Promise.resolve({ entries, repositoryId: 'repo-1' }),
		reclaimArchivedWorkspaceDisk,
	});
	return reclaimArchivedWorkspaceDisk;
}

/** Renders the archive browser open against the fixture project. */
function renderDialog(): void {
	renderWithProviders(
		<BrowseArchiveDialog
			onChange={vi.fn()}
			onOpenChange={vi.fn()}
			open={true}
			project={project()}
		/>,
	);
}

describe('browse archive reclaim', () => {
	afterEach(() => {
		clearEnsemblrApi();
	});

	it('reclaims a single row and reports what it freed', async () => {
		const reclaim = installBridge([entry()]);

		renderDialog();

		const button = await screen.findByTestId('browse-archive-row-reclaim');
		await userEvent.click(button);

		await waitFor(() => {
			expect(reclaim).toHaveBeenCalledWith({ workspaceIds: ['ws-1'] });
		});
		// Decimal, matching the SI prefix the unit actually names: 1.93e9 bytes is
		// 1.9 GB, not the 1.8 a 1024 step would print under the same label.
		expect(
			(await screen.findByTestId('browse-archive-reclaimed')).textContent,
		).toContain('1.9 GB');
	});

	// A row with nothing on disk is a dead button: the archive predates pruning,
	// was already reclaimed, or the user deleted the folder by hand.
	it('offers no reclaim button when the worktree is already gone', async () => {
		installBridge([entry({ pathExists: false, worktreePruned: true })]);

		renderDialog();

		await screen.findByTestId('browse-archive-row');
		expect(screen.queryByTestId('browse-archive-row-reclaim')).toBeNull();
		expect(screen.queryByTestId('browse-archive-reclaim-all')).toBeNull();
	});

	// Every button here drives git against one repository, and two
	// `git worktree remove` runs contend on the worktree admin lock and fail
	// rather than wait, so one reclaim in flight has to lock all of them.
	it('locks every other action while a single row is reclaiming', async () => {
		let release = (): void => {};
		const blocked = new Promise<void>((resolve) => {
			release = () => {
				resolve();
			};
		});
		installEnsemblrApi({
			listArchivedWorkspaces: () =>
				Promise.resolve({
					entries: [
						entry(),
						entry({ id: 'ws-2', name: 'eng-2', slug: 'eng-2' }),
					],
					repositoryId: 'repo-1',
				}),
			reclaimArchivedWorkspaceDisk: (request: { workspaceIds: string[] }) =>
				blocked.then(() => ({
					bytesFreed: 0,
					diagnostics: [],
					entries: request.workspaceIds.map((workspaceId) => ({
						bytesFreed: 0,
						diagnostics: [],
						status: 'reclaimed',
						workspaceId,
					})),
					reclaimedCount: request.workspaceIds.length,
				})),
		});

		renderDialog();

		const [firstReclaim, secondReclaim] = await screen.findAllByTestId(
			'browse-archive-row-reclaim',
		);
		await userEvent.click(firstReclaim as HTMLElement);

		await waitFor(() => {
			expect(screen.getByTestId('browse-archive-reclaim-all')).toBeDisabled();
		});
		expect(secondReclaim).toBeDisabled();

		release();
		await waitFor(() => {
			expect(screen.getByTestId('browse-archive-reclaim-all')).toBeEnabled();
		});
	});

	// An empty or unparseable request answers with no entries, so without the
	// request-level diagnostic the dialog would render an ordinary clean run.
	it('shows a refusal that belongs to no row above the list', async () => {
		installEnsemblrApi({
			listArchivedWorkspaces: () =>
				Promise.resolve({ entries: [entry()], repositoryId: 'repo-1' }),
			reclaimArchivedWorkspaceDisk: () =>
				Promise.resolve({
					bytesFreed: 0,
					diagnostics: [
						{
							code: 'workspace-ids-required',
							message: 'No workspace was named to reclaim.',
							severity: 'error',
						},
					],
					entries: [],
					reclaimedCount: 0,
				}),
		});

		renderDialog();

		await userEvent.click(
			await screen.findByTestId('browse-archive-row-reclaim'),
		);

		expect(
			(await screen.findByTestId('browse-archive-diagnostics')).textContent,
		).toContain('No workspace was selected');
	});

	it('reclaims every row still on disk in one call', async () => {
		const reclaim = installBridge(
			[
				entry(),
				entry({ id: 'ws-2', name: 'eng-2', slug: 'eng-2' }),
				entry({
					id: 'ws-3',
					name: 'eng-3',
					pathExists: false,
					slug: 'eng-3',
					worktreePruned: true,
				}),
			],
			{ bytesFreed: 2_147_483_648, reclaimedCount: 2 },
		);

		renderDialog();

		await userEvent.click(
			await screen.findByTestId('browse-archive-reclaim-all'),
		);

		await waitFor(() => {
			// The already-pruned row is left out rather than sent and skipped.
			expect(reclaim).toHaveBeenCalledWith({
				workspaceIds: ['ws-1', 'ws-2'],
			});
		});
	});
});
