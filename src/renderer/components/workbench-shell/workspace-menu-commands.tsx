import { type ReactNode, useState } from 'react';
import { useRemoveWorkspaceAction } from '@/renderer/hooks/workbench-shell/use-remove-workspace-action';
import {
	useMenuCommand,
	useMenuCommandChecked,
} from '@/renderer/state/menu-commands';
import {
	useWorkspaceBoardActions,
	useWorkspaceBoardStatus,
} from '@/renderer/state/workspace';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import { ArchiveWorkspaceDialog } from './archive-workspace-dialog';
import { DeleteWorkspaceDialog } from './delete-workspace-dialog';
import { RenameWorkspaceDialog } from './rename-workspace-dialog';

/** Which lifecycle dialog the Workspace menu opened, or null when none is. */
type ActiveWorkspaceDialog = 'archive' | 'delete' | 'rename' | null;

/**
 * Registers the Workspace menu's commands for the workspace on screen, and
 * returns the lifecycle dialogs to mount once beside the shell.
 *
 * The dialogs are mounted here rather than reused from the sidebar row because
 * the menu acts on the *active* workspace, which the sidebar row for it may not
 * even be rendering — a collapsed sidebar or a filtered list would leave the
 * menu commands dead.
 * @param workspace - The workspace currently on screen
 * @returns The dialog nodes the caller renders once
 */
export function useWorkspaceMenuCommands(
	workspace: WorkspaceShellModel,
): ReactNode {
	const [activeDialog, setActiveDialog] = useState<ActiveWorkspaceDialog>(null);
	const currentStatus = useWorkspaceBoardStatus(workspace.id);
	const { setWorkspaceBoardStatus } = useWorkspaceBoardActions();
	const handleWorkspaceRemoved = useRemoveWorkspaceAction({
		activeWorkspaceId: workspace.id,
	});

	useMenuCommand('workspace.rename', () => setActiveDialog('rename'));
	useMenuCommand('workspace.archive', () => setActiveDialog('archive'));
	useMenuCommand('workspace.delete', () => setActiveDialog('delete'));

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

	return (
		<>
			<ArchiveWorkspaceDialog
				onArchived={handleWorkspaceRemoved}
				onOpenChange={(open) => {
					if (!open) {
						setActiveDialog(null);
					}
				}}
				open={activeDialog === 'archive'}
				workspace={workspace}
			/>
			<DeleteWorkspaceDialog
				onDeleted={handleWorkspaceRemoved}
				onOpenChange={(open) => {
					if (!open) {
						setActiveDialog(null);
					}
				}}
				open={activeDialog === 'delete'}
				workspace={workspace}
			/>
			<RenameWorkspaceDialog
				onOpenChange={(open) => {
					if (!open) {
						setActiveDialog(null);
					}
				}}
				open={activeDialog === 'rename'}
				workspace={workspace}
			/>
		</>
	);
}
