import { useSetAtom } from 'jotai';
import { useArchiveWorkspaceAction } from '@/renderer/hooks/workbench-shell/use-archive-workspace-action';
import { workspaceLifecycleDialogAtom } from '@/renderer/state/dialogs';
import {
	useMenuCommand,
	useMenuCommandChecked,
} from '@/renderer/state/menu-commands';
import {
	useWorkspaceBoardActions,
	useWorkspaceBoardStatus,
	useWorkspaceLifecycleRun,
} from '@/renderer/state/workspace';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/**
 * Registers the Workspace menu's commands for the workspace on screen.
 *
 * The lifecycle dialogs they raise are mounted by
 * `WorkspaceLifecycleDialogHost` at shell level, not here: confirming a delete
 * removes this very workspace, which unmounts this view along with anything it
 * had mounted. They are raised through an atom for the same reason they cannot
 * be reused from the sidebar row — the menu acts on the *active* workspace,
 * whose row a collapsed sidebar or a filtered list may not render at all.
 *
 * Archive, delete and rename all grey out while an archive or a delete is in
 * flight, so the menu cannot start a second run against a workspace already
 * being torn down, or rename one that is about to stop existing.
 * @param workspace - The workspace currently on screen
 */
export function useWorkspaceMenuCommands(workspace: WorkspaceShellModel): void {
	const currentStatus = useWorkspaceBoardStatus(workspace.id);
	const { setWorkspaceBoardStatus } = useWorkspaceBoardActions();
	const requestLifecycleDialog = useSetAtom(workspaceLifecycleDialogAtom);
	const archiveWorkspace = useArchiveWorkspaceAction({
		activeWorkspaceId: workspace.id,
	});
	const lifecycleRun = useWorkspaceLifecycleRun(workspace.id);

	const isTearingDown = lifecycleRun !== null;

	useMenuCommand(
		'workspace.rename',
		() => requestLifecycleDialog({ kind: 'rename', workspace }),
		!isTearingDown,
	);
	useMenuCommand(
		'workspace.archive',
		() => {
			void archiveWorkspace(workspace);
		},
		!isTearingDown,
	);
	useMenuCommand(
		'workspace.delete',
		() => requestLifecycleDialog({ kind: 'delete', workspace }),
		!isTearingDown,
	);

	useMenuCommand('workspace.status.backlog', () =>
		setWorkspaceBoardStatus(workspace.id, 'backlog'),
	);
	useMenuCommand('workspace.status.inProgress', () =>
		setWorkspaceBoardStatus(workspace.id, 'in-progress'),
	);
	useMenuCommand('workspace.status.inReview', () =>
		setWorkspaceBoardStatus(workspace.id, 'in-review'),
	);
	useMenuCommand('workspace.status.done', () =>
		setWorkspaceBoardStatus(workspace.id, 'done'),
	);
	useMenuCommand('workspace.status.cancelled', () =>
		setWorkspaceBoardStatus(workspace.id, 'canceled'),
	);
	useMenuCommandChecked(
		'workspace.status.backlog',
		currentStatus === 'backlog',
	);
	useMenuCommandChecked(
		'workspace.status.inProgress',
		currentStatus === 'in-progress',
	);
	useMenuCommandChecked(
		'workspace.status.inReview',
		currentStatus === 'in-review',
	);
	useMenuCommandChecked('workspace.status.done', currentStatus === 'done');
	useMenuCommandChecked(
		'workspace.status.cancelled',
		currentStatus === 'canceled',
	);
}
