// @vitest-environment happy-dom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArchiveRepositoryDialog } from '@/renderer/components/workbench-shell/archive-repository-dialog';
import { ArchiveWorkspaceDialog } from '@/renderer/components/workbench-shell/archive-workspace-dialog';
import { DeleteRepositoryDialog } from '@/renderer/components/workbench-shell/delete-repository-dialog';
import { DeleteWorkspaceDialog } from '@/renderer/components/workbench-shell/delete-workspace-dialog';
import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

/** Minimal workspace shell model the lifecycle dialogs read. */
function workspace(): WorkspaceShellModel {
	return {
		branchName: 'feature/doomed',
		changeSummary: { additions: 0, deletions: 0, files: 0 },
		id: 'ws-doomed',
		name: 'doomed',
		pathLabel: '/tmp/ws-doomed',
		pullRequest: {},
		sessions: [],
		workspaceFiles: [],
	} as unknown as WorkspaceShellModel;
}

/** Minimal project shell model the repository lifecycle dialogs read. */
function project(): ProjectShellModel {
	return {
		id: 'repo-doomed',
		name: 'doomed',
		workspaces: [],
	} as unknown as ProjectShellModel;
}

describe('lifecycle dialogs close independently of post-removal navigation', () => {
	beforeEach(() => {
		installEnsemblrApi({
			archiveRepository: () => Promise.resolve({ status: 'success' }),
			archiveWorkspace: () => Promise.resolve({ status: 'success' }),
			deleteRepository: () => Promise.resolve({ status: 'success' }),
			deleteWorkspace: () => Promise.resolve({ status: 'success' }),
		});
	});

	afterEach(() => {
		clearEnsemblrApi();
	});

	// The removal itself commits before the callback runs, so a callback that
	// never settles — `useRemoveWorkspaceAction` awaits `navigate()`, which does
	// not resolve while a redirect loop is bouncing — must not hold the modal up.
	// The overlay captures pointer events, so a dialog that never closes reads to
	// the user as the whole app freezing.
	it('closes the delete dialog when onDeleted never settles', async () => {
		const onOpenChange = vi.fn();
		renderWithProviders(
			<DeleteWorkspaceDialog
				onDeleted={() => new Promise<void>(() => {})}
				onOpenChange={onOpenChange}
				open={true}
				workspace={workspace()}
			/>,
		);

		await userEvent.click(screen.getByRole('button', { name: /delete/i }));

		await waitFor(() => {
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});
	});

	// `workspace-menu-commands.tsx` holds `open` and `workspace` in separate state,
	// so removing the active workspace nulls the workspace while `open` is still
	// true. Rendering that as an open dialog leaves an empty shell whose overlay
	// swallows every click, with no content and no way to dismiss it.
	it.each([
		['delete', DeleteWorkspaceDialog],
		['archive', ArchiveWorkspaceDialog],
	])(
		'renders no %s dialog when open with a null workspace',
		(_name, Component) => {
			renderWithProviders(
				<Component
					onArchived={vi.fn()}
					onDeleted={vi.fn()}
					onOpenChange={vi.fn()}
					open={true}
					workspace={null}
				/>,
			);

			expect(screen.queryByRole('dialog')).toBeNull();
		},
	);

	it('closes the archive dialog when onArchived never settles', async () => {
		const onOpenChange = vi.fn();
		renderWithProviders(
			<ArchiveWorkspaceDialog
				onArchived={() => new Promise<void>(() => {})}
				onOpenChange={onOpenChange}
				open={true}
				workspace={workspace()}
			/>,
		);

		await userEvent.click(screen.getByRole('button', { name: /^archive$/i }));

		await waitFor(() => {
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});
	});

	// The repository dialogs run the same flow over a slower removal — deleting a
	// repository tears down every worktree and the clone — so the overlay is up
	// for longer, and they are the pair most likely to be missed when the
	// workspace dialogs are fixed on their own.
	it.each([
		['delete', DeleteRepositoryDialog, /^delete$/i],
		['archive', ArchiveRepositoryDialog, /^archive$/i],
	])(
		'closes the repository %s dialog when its callback never settles',
		async (_name, Component, buttonName) => {
			const onOpenChange = vi.fn();
			renderWithProviders(
				<Component
					onArchived={() => new Promise<void>(() => {})}
					onDeleted={() => new Promise<void>(() => {})}
					onOpenChange={onOpenChange}
					open={true}
					project={project()}
				/>,
			);

			await userEvent.click(screen.getByRole('button', { name: buttonName }));

			await waitFor(() => {
				expect(onOpenChange).toHaveBeenCalledWith(false);
			});
		},
	);

	it.each([
		['delete', DeleteRepositoryDialog],
		['archive', ArchiveRepositoryDialog],
	])(
		'renders no repository %s dialog when open with a null project',
		(_name, Component) => {
			renderWithProviders(
				<Component
					onArchived={vi.fn()}
					onDeleted={vi.fn()}
					onOpenChange={vi.fn()}
					open={true}
					project={null}
				/>,
			);

			expect(screen.queryByRole('dialog')).toBeNull();
		},
	);
});
