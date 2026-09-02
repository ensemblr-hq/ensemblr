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

import { DeleteWorkspaceDialog } from '@/renderer/components/workbench-shell/delete-workspace-dialog';
import { workspaceLifecycleRunsAtom } from '@/renderer/state/workspace/workspace-lifecycle-runs';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

const store = getDefaultStore();

/** Minimal workspace shell model the delete dialog reads. */
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

/** Renders the dialog with the user standing in the workspace it deletes. */
function renderDialog(onDeleted = vi.fn()): void {
	renderWithProviders(
		<DeleteWorkspaceDialog
			activeWorkspaceId='ws-doomed'
			onDeleted={onDeleted}
			onOpenChange={vi.fn()}
			open={true}
			workspace={workspace()}
		/>,
	);
}

/** Clicks the dialog's Delete button once it is live. */
async function confirmDelete(): Promise<void> {
	const action = await screen.findByRole('button', { name: 'Delete' });
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

// A delete takes the worktree apart exactly the way an archive does — terminals
// stopped, folder removed — so it carries the same live state. Without it the
// row stays interactive and openable while the folder it names is being
// removed, and the loaders will happily redirect back into it.
describe('delete workspace dialog live state', () => {
	it('marks the workspace deleting for the whole run', async () => {
		let finishDelete: () => void = () => undefined;
		installEnsemblrApi({
			deleteWorkspace: () =>
				new Promise((resolve) => {
					finishDelete = () =>
						resolve({
							branchDeleted: true,
							diagnostics: [],
							pathRemoved: true,
							status: 'success',
							workspace: null,
						});
				}),
		});
		renderDialog();

		await confirmDelete();

		await waitFor(() => {
			expect(store.get(workspaceLifecycleRunsAtom).get('ws-doomed')).toBe(
				'deleting',
			);
		});

		finishDelete();

		await waitFor(() => {
			expect(store.get(workspaceLifecycleRunsAtom).has('ws-doomed')).toBe(
				false,
			);
		});
	});

	it('leaves the workspace before its teardown starts', async () => {
		installEnsemblrApi({
			deleteWorkspace: () => {
				expect(navigate).toHaveBeenCalledWith({ replace: true, to: '/' });
				return Promise.resolve({
					branchDeleted: true,
					diagnostics: [],
					pathRemoved: true,
					status: 'success',
					workspace: null,
				});
			},
		});
		const onDeleted = vi.fn();
		renderDialog(onDeleted);

		await confirmDelete();

		await waitFor(() => {
			expect(onDeleted).toHaveBeenCalledWith('ws-doomed');
		});
	});

	it('puts the user back when the delete failed', async () => {
		installEnsemblrApi({
			deleteWorkspace: () =>
				Promise.resolve({
					branchDeleted: false,
					diagnostics: [
						{
							code: 'workspace-delete-failed',
							message: 'worktree is locked',
							severity: 'error',
						},
					],
					pathRemoved: false,
					status: 'failure',
					workspace: null,
				}),
		});
		renderDialog();

		await confirmDelete();

		await waitFor(() => {
			expect(navigate).toHaveBeenCalledWith({
				href: RETURN_HREF,
				replace: true,
			});
		});
		expect(store.get(workspaceLifecycleRunsAtom).has('ws-doomed')).toBe(false);
	});
});
