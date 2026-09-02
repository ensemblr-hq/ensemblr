import { useAtom } from 'jotai';
import { useCallback, useEffect, useState } from 'react';

import { useArchivedWorkspaceToast } from '@/renderer/hooks/workbench-shell/use-archive-workspace-action';
import { useRemoveWorkspaceAction } from '@/renderer/hooks/workbench-shell/use-remove-workspace-action';
import type { ArchivedWorkspace } from '@/renderer/lib/workbench/archive-worktree-plan';
import {
	type WorkspaceLifecycleDialogRequest,
	workspaceLifecycleDialogAtom,
} from '@/renderer/state/dialogs';

import { ArchiveWorkspaceDialog } from './archive-workspace-dialog';
import { DeleteWorkspaceDialog } from './delete-workspace-dialog';
import { RenameWorkspaceDialog } from './rename-workspace-dialog';

/**
 * Mounts the Workspace menu's archive, delete, and rename dialogs once, at shell
 * level, driven by {@link workspaceLifecycleDialogAtom}.
 *
 * They deliberately do not live in the workspace view that raises them.
 * Confirming an archive or a delete removes that workspace, which unmounts the
 * view while the dialog is still closing; a Radix modal destroyed by an ancestor
 * unmount never runs the cleanup that releases `pointer-events` on `<body>`, and
 * the whole front end is left unclickable with no layer around to dismiss. The
 * shell outlives every removal, so the dialog always closes itself.
 */
export function WorkspaceLifecycleDialogHost({
	activeWorkspaceId,
}: {
	activeWorkspaceId: string | null;
}) {
	const [request, setRequest] = useAtom(workspaceLifecycleDialogAtom);
	const handleWorkspaceRemoved = useRemoveWorkspaceAction({
		activeWorkspaceId,
	});
	const announceArchived = useArchivedWorkspaceToast();
	// Radix keeps a closing dialog mounted for its exit animation. Dropping the
	// workspace the instant the request clears would empty the panel for those
	// frames, which is the "shell with no content" the removal used to leave on
	// screen, so the last one stays available to paint the way out.
	const [closing, setClosing] =
		useState<WorkspaceLifecycleDialogRequest | null>(null);

	useEffect(() => {
		if (request) {
			setClosing(request);
		}
	}, [request]);

	const closeOnDismiss = useCallback(
		(open: boolean) => {
			if (!open) {
				setRequest(null);
			}
		},
		[setRequest],
	);

	const workspace = (request ?? closing)?.workspace ?? null;

	// Only the archives the instant path refuses to run reach this dialog, so
	// these are the ones most worth announcing. The toast reads the plan that ran
	// to decide whether it may offer to take it back.
	const handleArchived = useCallback(
		async (archived: ArchivedWorkspace) => {
			await handleWorkspaceRemoved.archived(archived.workspaceId);
			announceArchived(archived);
		},
		[announceArchived, handleWorkspaceRemoved.archived],
	);

	return (
		<>
			<ArchiveWorkspaceDialog
				onArchived={handleArchived}
				onOpenChange={closeOnDismiss}
				open={request?.kind === 'archive'}
				workspace={workspace}
			/>
			<DeleteWorkspaceDialog
				onDeleted={handleWorkspaceRemoved.deleted}
				onOpenChange={closeOnDismiss}
				open={request?.kind === 'delete'}
				workspace={workspace}
			/>
			<RenameWorkspaceDialog
				onOpenChange={closeOnDismiss}
				open={request?.kind === 'rename'}
				workspace={workspace}
			/>
		</>
	);
}
