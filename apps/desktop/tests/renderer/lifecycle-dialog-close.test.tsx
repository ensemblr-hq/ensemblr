// @vitest-environment happy-dom

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const toastWarning = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({
	toast: { error: vi.fn(), success: vi.fn(), warning: toastWarning },
}));

/**
 * Minimal workspace shell model the lifecycle dialogs read. The id is a
 * parameter because the hook latches a run in flight by target id, so a test
 * that deliberately leaves one hanging needs an id of its own.
 */
function workspace(id = 'ws-doomed'): WorkspaceShellModel {
	return {
		branchName: 'feature/doomed',
		changeSummary: { additions: 0, deletions: 0, files: 0 },
		id,
		name: 'doomed',
		pathLabel: `/tmp/${id}`,
		pullRequest: {},
		sessions: [],
		workspaceFiles: [],
	} as unknown as WorkspaceShellModel;
}

/** Path of the managed repositories root the stubbed root snapshot reports. */
const MANAGED_REPOSITORIES_PATH = '/tmp/ensemblr/repos';

/**
 * Minimal project shell model the repository lifecycle dialogs read. The path
 * defaults to one inside the managed root, which is what makes the delete
 * dialog offer to remove the folder.
 */
function project(
	id = 'repo-doomed',
	pathLabel = `${MANAGED_REPOSITORIES_PATH}/${id}`,
): ProjectShellModel {
	return {
		id,
		name: 'doomed',
		pathLabel,
		workspaces: [],
	} as unknown as ProjectShellModel;
}

/**
 * Mounts a lifecycle dialog the way every real call site does — one piece of
 * state driving both `open` and the target — so a test can assert the dialog
 * actually left the DOM rather than that a callback fired.
 */
function Host({
	Component,
	onSucceeded,
	target,
	targetId,
	targetPath,
}: {
	// biome-ignore lint/suspicious/noExplicitAny: one host drives every dialog
	Component: any;
	onSucceeded: () => Promise<void> | void;
	target: 'project' | 'workspace';
	targetId?: string;
	targetPath?: string;
}) {
	const [openTarget, setOpenTarget] = useState<
		ProjectShellModel | WorkspaceShellModel | null
	>(target === 'project' ? project(targetId, targetPath) : workspace(targetId));
	const targetProps =
		target === 'project' ? { project: openTarget } : { workspace: openTarget };

	return (
		<Component
			onArchived={onSucceeded}
			onDeleted={onSucceeded}
			onOpenChange={(open: boolean) => {
				if (!open) {
					setOpenTarget(null);
				}
			}}
			open={openTarget !== null}
			{...targetProps}
		/>
	);
}

/**
 * Mounts a dialog whose target survives being dismissed, the way the real menu
 * call sites do: closing drops `open` but leaves the workspace in the list, so
 * the user can open the same dialog again.
 */
function ReopenableHost({
	onDeleted,
	targetId,
}: {
	onDeleted: () => Promise<void> | void;
	targetId: string;
}) {
	const [open, setOpen] = useState(true);

	return (
		<>
			<button onClick={() => setOpen(true)} type='button'>
				reopen
			</button>
			<DeleteWorkspaceDialog
				activeWorkspaceId={null}
				onDeleted={onDeleted}
				onOpenChange={setOpen}
				open={open}
				workspace={workspace(targetId)}
			/>
		</>
	);
}

/** A promise that never settles, standing in for a navigation that stalls. */
function never(): Promise<void> {
	return new Promise<void>(() => {});
}

/**
 * Installs the stub bridge with every channel the lifecycle dialogs reach,
 * `resolveSettings` included — the archive dialog reads the repository's
 * branch-cleanup policy before it will let the user archive.
 */
function installLifecycleApi(overrides: Record<string, unknown> = {}): void {
	installEnsemblrApi({
		archiveWorkspace: () =>
			Promise.resolve({ diagnostics: [], status: 'success' }),
		deleteRepository: () =>
			Promise.resolve({ diagnostics: [], status: 'success' }),
		deleteWorkspace: () =>
			Promise.resolve({ diagnostics: [], status: 'success' }),
		rootDirectory: () =>
			Promise.resolve({
				repositoriesPath: MANAGED_REPOSITORIES_PATH,
				status: 'ok',
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
		...overrides,
	});
}

/** Clicks a lifecycle dialog's action button once it is enabled. */
async function clickAction(name: RegExp): Promise<void> {
	const action = screen.getByRole('button', { name });
	await waitFor(() => {
		expect(action).not.toBeDisabled();
	});
	await userEvent.click(action);
}

/**
 * Finds a footer button by name. Scoped to the footer because `DialogContent`
 * renders its own corner dismiss with the screen-reader name "Close", which
 * would otherwise tie with the footer's own once the run is in flight.
 */
function footerButton(name: RegExp): HTMLElement {
	const footer = document.querySelector('[data-slot="dialog-footer"]');
	if (!footer) {
		throw new Error('no lifecycle dialog footer on screen');
	}
	return within(footer as HTMLElement).getByRole('button', { name });
}

/** Whether the footer currently offers a button with this name. */
function hasFooterButton(name: RegExp): boolean {
	const footer = document.querySelector('[data-slot="dialog-footer"]');
	return footer
		? within(footer as HTMLElement).queryByRole('button', { name }) !== null
		: false;
}

describe('lifecycle dialogs close independently of post-removal navigation', () => {
	beforeEach(() => {
		installLifecycleApi();
	});

	afterEach(() => {
		clearEnsemblrApi();
	});

	// The removal commits before the callback runs, so a callback that never
	// settles — `useRemoveWorkspaceAction` awaits `navigate()`, which does not
	// resolve while a redirect loop is bouncing — must not hold the modal up.
	// Asserting on `onOpenChange` is not enough: React batches a plain close with
	// everything the callback then does, so the dialog can stay on screen through
	// a close that was "called". Assert it left the DOM.
	it.each([
		['delete workspace', DeleteWorkspaceDialog, 'workspace', /^delete$/i],
		['archive workspace', ArchiveWorkspaceDialog, 'workspace', /^archive$/i],
		['delete repository', DeleteRepositoryDialog, 'project', /^delete$/i],
	] as const)(
		'removes the %s dialog from the DOM when the post-removal work never settles',
		async (_name, Component, target, buttonName) => {
			renderWithProviders(
				<Host Component={Component} onSucceeded={never} target={target} />,
			);

			await clickAction(buttonName);

			await waitFor(() => {
				expect(screen.queryByRole('dialog')).toBeNull();
			});
		},
	);

	// The close has to be committed *before* the post-removal work starts, not
	// merely called first: React batches a plain `setState` here with everything
	// the callback then does — the navigation, the cache invalidation — into one
	// commit, so the modal stays painted until that whole render lands and a
	// navigation that stalls holds it up for good.
	it.each([
		['delete workspace', DeleteWorkspaceDialog, 'workspace', /^delete$/i],
		['archive workspace', ArchiveWorkspaceDialog, 'workspace', /^archive$/i],
		['delete repository', DeleteRepositoryDialog, 'project', /^delete$/i],
	] as const)(
		'has the %s dialog off screen by the time the post-removal work starts',
		async (_name, Component, target, buttonName) => {
			let dialogAtHandoff: unknown = 'not called';
			renderWithProviders(
				<Host
					Component={Component}
					onSucceeded={() => {
						dialogAtHandoff = document.querySelector('[role="dialog"]');
						return never();
					}}
					target={target}
				/>,
			);

			await clickAction(buttonName);

			await waitFor(() => {
				expect(dialogAtHandoff).not.toBe('not called');
			});
			expect(dialogAtHandoff).toBeNull();
		},
	);

	// A rejected invoke — the permission gate denies the channel, or main is
	// wedged — used to leave the dialog on "Deleting…" forever with both footer
	// buttons disabled and nothing on screen explaining why.
	it.each([
		[
			'delete workspace',
			DeleteWorkspaceDialog,
			'workspace',
			'deleteWorkspace',
			/^delete$/i,
			'delete-workspace-diagnostics',
		],
		[
			'archive workspace',
			ArchiveWorkspaceDialog,
			'workspace',
			'archiveWorkspace',
			/^archive$/i,
			'archive-workspace-diagnostics',
		],
		[
			'delete repository',
			DeleteRepositoryDialog,
			'project',
			'deleteRepository',
			/^delete$/i,
			'delete-repository-diagnostics',
		],
	] as const)(
		'shows a diagnostic and stays usable when the %s call rejects',
		async (_name, Component, target, channel, buttonName, diagnosticsTestId) => {
			const onSettled = vi.fn();
			installLifecycleApi({
				[channel]: () => Promise.reject(new Error('Permission denied')),
			});

			renderWithProviders(
				<Host Component={Component} onSucceeded={onSettled} target={target} />,
			);

			await clickAction(buttonName);

			expect(await screen.findByTestId(diagnosticsTestId)).toBeTruthy();
			expect(screen.getByRole('dialog')).toBeTruthy();
			expect(onSettled).not.toHaveBeenCalled();
			expect(
				screen.getByRole('button', { name: /^cancel$/i }),
			).not.toBeDisabled();
			expect(
				screen.getByRole('button', { name: buttonName }),
			).not.toBeDisabled();
		},
	);

	// A lifecycle hook can veto an archive, which reports `'aborted'` rather than
	// `'failure'`. Treating anything that is not `'success'` as done would close
	// the dialog and run the post-removal navigation on a workspace that is still
	// there.
	it.each([
		[
			'workspace',
			ArchiveWorkspaceDialog,
			'workspace',
			'archiveWorkspace',
			'archive-workspace-diagnostics',
		],
	] as const)(
		'keeps the %s archive dialog open when a hook aborts the run',
		async (_name, Component, target, channel, diagnosticsTestId) => {
			const onSettled = vi.fn();
			installLifecycleApi({
				[channel]: () =>
					Promise.resolve({
						diagnostics: [
							{
								code: 'archive-aborted-by-hook',
								message: 'A pre-archive hook vetoed the run.',
								severity: 'error',
							},
						],
						status: 'aborted',
					}),
			});

			renderWithProviders(
				<Host Component={Component} onSucceeded={onSettled} target={target} />,
			);

			await clickAction(/^archive$/i);

			expect(await screen.findByTestId(diagnosticsTestId)).toBeTruthy();
			expect(screen.getByRole('dialog')).toBeTruthy();
			expect(onSettled).not.toHaveBeenCalled();
		},
	);

	// The dismiss button stays live while the run is in flight — Escape, the
	// overlay and the corner button all dismiss a busy dialog anyway, and an IPC
	// that never answers would otherwise trap the user behind the overlay. It
	// must not still read "Cancel" there: the removal has already committed and
	// dismissing the dialog does not call it back.
	it.each([
		[
			'delete workspace',
			DeleteWorkspaceDialog,
			'workspace',
			'deleteWorkspace',
			/^delete$/i,
		],
		[
			'archive workspace',
			ArchiveWorkspaceDialog,
			'workspace',
			'archiveWorkspace',
			/^archive$/i,
		],
		[
			'delete repository',
			DeleteRepositoryDialog,
			'project',
			'deleteRepository',
			/^delete$/i,
		],
	] as const)(
		'offers Close rather than Cancel while the %s run is in flight',
		async (name, Component, target, channel, buttonName) => {
			installLifecycleApi({ [channel]: () => never() });

			renderWithProviders(
				<Host
					Component={Component}
					onSucceeded={vi.fn()}
					target={target}
					targetId={`inflight-${name.replace(/ /g, '-')}`}
				/>,
			);

			expect(footerButton(/^cancel$/i)).toBeTruthy();

			await clickAction(buttonName);

			await waitFor(() => {
				expect(hasFooterButton(/^close$/i)).toBe(true);
			});
			expect(footerButton(/^close$/i)).not.toBeDisabled();
			expect(hasFooterButton(/^cancel$/i)).toBe(false);
		},
	);

	// Dismissing mid-run tears the form down, and reopening builds a fresh one
	// with its own `isBusy`. Without a latch that outlives the mount, the second
	// dialog happily fires a second destructive IPC over the first.
	it('starts no second delete when the dialog is dismissed mid-run and reopened', async () => {
		const deleteWorkspace = vi.fn(() => never());
		installLifecycleApi({ deleteWorkspace });

		renderWithProviders(
			<ReopenableHost onDeleted={vi.fn()} targetId='ws-reopened' />,
		);

		await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
		expect(deleteWorkspace).toHaveBeenCalledTimes(1);

		await waitFor(() => {
			expect(hasFooterButton(/^close$/i)).toBe(true);
		});
		await userEvent.click(footerButton(/^close$/i));
		await waitFor(() => {
			expect(screen.queryByRole('dialog')).toBeNull();
		});

		await userEvent.click(screen.getByRole('button', { name: /reopen/i }));
		await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

		expect(deleteWorkspace).toHaveBeenCalledTimes(1);
	});

	// The latch used to `return` silently, which left the reopened dialog's button
	// dead with nothing on screen saying why. A workspace that cannot be deleted
	// and will not say so is indistinguishable from a frozen app.
	it('reports the blocked retry instead of leaving the button dead', async () => {
		const deleteWorkspace = vi.fn(() => never());
		installLifecycleApi({ deleteWorkspace });

		renderWithProviders(
			<ReopenableHost onDeleted={vi.fn()} targetId='ws-latched' />,
		);

		await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
		await waitFor(() => {
			expect(hasFooterButton(/^close$/i)).toBe(true);
		});
		await userEvent.click(footerButton(/^close$/i));
		await waitFor(() => {
			expect(screen.queryByRole('dialog')).toBeNull();
		});

		await userEvent.click(screen.getByRole('button', { name: /reopen/i }));
		expect(screen.queryByTestId('delete-workspace-diagnostics')).toBeNull();

		await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

		await waitFor(() => {
			expect(
				screen.getByTestId('delete-workspace-diagnostics'),
			).toBeInTheDocument();
		});
		expect(deleteWorkspace).toHaveBeenCalledTimes(1);
	});

	// Two clicks dispatched in one task both read the same render's `isBusy`, so
	// a plain state guard lets both through and the destructive IPC runs twice.
	it('starts the delete once when the action is fired twice in one task', async () => {
		const deleteWorkspace = vi.fn(() =>
			Promise.resolve({ diagnostics: [], status: 'success' }),
		);
		installLifecycleApi({ deleteWorkspace });

		renderWithProviders(
			<Host
				Component={DeleteWorkspaceDialog}
				onSucceeded={never}
				target='workspace'
				targetId='ws-double-fired'
			/>,
		);

		const action = screen.getByRole('button', { name: /^delete$/i });
		action.click();
		action.click();

		await waitFor(() => {
			expect(deleteWorkspace).toHaveBeenCalled();
		});
		expect(deleteWorkspace).toHaveBeenCalledTimes(1);
	});

	// The dialog is already gone by the time the post-removal work runs, so a
	// rejection there has nowhere to render. It must still not escape as an
	// unhandled rejection — nothing awaits `start`, it is an `onClick`.
	it('reports rather than swallows a post-removal callback that rejects', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		renderWithProviders(
			<Host
				Component={DeleteWorkspaceDialog}
				onSucceeded={() => Promise.reject(new Error('navigation exploded'))}
				target='workspace'
				targetId='ws-rejecting-callback'
			/>,
		);

		await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

		await waitFor(() => {
			expect(logged).toHaveBeenCalled();
		});
		expect(screen.queryByRole('dialog')).toBeNull();
		logged.mockRestore();
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
					activeWorkspaceId={null}
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

	it('renders no repository delete dialog when open with a null project', () => {
		renderWithProviders(
			<DeleteRepositoryDialog
				onDeleted={vi.fn()}
				onOpenChange={vi.fn()}
				open={true}
				project={null}
			/>,
		);

		expect(screen.queryByRole('dialog')).toBeNull();
	});
});

describe('delete repository folder checkbox', () => {
	beforeEach(() => {
		toastWarning.mockClear();
	});

	afterEach(() => {
		clearEnsemblrApi();
	});

	it('sends the folder flag when the checkbox is ticked', async () => {
		const deleteRepository = vi.fn(() =>
			Promise.resolve({ diagnostics: [], status: 'success' }),
		);
		installLifecycleApi({ deleteRepository });

		renderWithProviders(
			<Host
				Component={DeleteRepositoryDialog}
				onSucceeded={vi.fn()}
				target='project'
				targetId='repo-folder-on'
			/>,
		);

		const checkbox = await screen.findByRole('checkbox');
		await userEvent.click(checkbox);
		await clickAction(/^delete$/i);

		expect(deleteRepository).toHaveBeenCalledWith({
			deleteFolder: true,
			repositoryId: 'repo-folder-on',
		});
	});

	it('leaves the folder alone when the checkbox is untouched', async () => {
		const deleteRepository = vi.fn(() =>
			Promise.resolve({ diagnostics: [], status: 'success' }),
		);
		installLifecycleApi({ deleteRepository });

		renderWithProviders(
			<Host
				Component={DeleteRepositoryDialog}
				onSucceeded={vi.fn()}
				target='project'
				targetId='repo-folder-off'
			/>,
		);

		await screen.findByRole('checkbox');
		await clickAction(/^delete$/i);

		expect(deleteRepository).toHaveBeenCalledWith({
			deleteFolder: false,
			repositoryId: 'repo-folder-off',
		});
	});

	it('does not offer the checkbox for a repository outside the managed root', async () => {
		installLifecycleApi();

		renderWithProviders(
			<Host
				Component={DeleteRepositoryDialog}
				onSucceeded={vi.fn()}
				target='project'
				targetId='repo-external'
				targetPath='/Users/someone/dev/my-project'
			/>,
		);

		await screen.findByRole('dialog');
		await waitFor(() => {
			expect(
				screen.getByRole('button', { name: /^delete$/i }),
			).not.toBeDisabled();
		});
		expect(screen.queryByRole('checkbox')).toBeNull();
	});

	it('describes the checkbox by its warning once it is ticked', async () => {
		installLifecycleApi();

		renderWithProviders(
			<Host
				Component={DeleteRepositoryDialog}
				onSucceeded={vi.fn()}
				target='project'
				targetId='repo-folder-a11y'
			/>,
		);

		const checkbox = await screen.findByRole('checkbox');
		expect(checkbox).not.toHaveAttribute('aria-describedby');

		await userEvent.click(checkbox);

		const describedBy = checkbox.getAttribute('aria-describedby');
		expect(describedBy).toBeTruthy();
		expect(document.getElementById(describedBy ?? '')?.textContent).toMatch(
			/uncommitted work/i,
		);
	});

	it('warns when the folder survives a delete the user asked for', async () => {
		const deleteRepository = vi.fn(() =>
			Promise.resolve({
				diagnostics: [
					{
						code: 'repository-folder-external',
						message: 'Refused to remove /tmp/ensemblr/repos/repo-survivor.',
						path: '/tmp/ensemblr/repos/repo-survivor',
						severity: 'warning',
					},
				],
				repository: { folderDeleted: false, id: 'repo-survivor' },
				status: 'success',
			}),
		);
		installLifecycleApi({ deleteRepository });

		renderWithProviders(
			<Host
				Component={DeleteRepositoryDialog}
				onSucceeded={vi.fn()}
				target='project'
				targetId='repo-survivor'
			/>,
		);

		await userEvent.click(await screen.findByRole('checkbox'));
		await clickAction(/^delete$/i);

		await waitFor(() => {
			expect(toastWarning).toHaveBeenCalledWith(
				expect.stringContaining('outside the folder Ensemblr manages'),
				{ description: '/tmp/ensemblr/repos/repo-survivor' },
			);
		});
	});

	it('stays quiet when the folder really was removed', async () => {
		const deleteRepository = vi.fn(() =>
			Promise.resolve({
				diagnostics: [],
				repository: { folderDeleted: true, id: 'repo-gone' },
				status: 'success',
			}),
		);
		installLifecycleApi({ deleteRepository });

		renderWithProviders(
			<Host
				Component={DeleteRepositoryDialog}
				onSucceeded={vi.fn()}
				target='project'
				targetId='repo-gone'
			/>,
		);

		await userEvent.click(await screen.findByRole('checkbox'));
		await clickAction(/^delete$/i);

		await waitFor(() => {
			expect(deleteRepository).toHaveBeenCalled();
		});
		expect(toastWarning).not.toHaveBeenCalled();
	});
});
