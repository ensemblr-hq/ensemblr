import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useState,
} from 'react';

import { useArchiveWorkspaceAction } from '@/renderer/hooks/workbench-shell/use-archive-workspace-action';
import { useRemoveWorkspaceAction } from '@/renderer/hooks/workbench-shell/use-remove-workspace-action';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { DeleteWorkspaceDialog } from '../delete-workspace-dialog';
import { RenameWorkspaceDialog } from '../rename-workspace-dialog';

/** Per-workspace board card actions: archive outright, or open the delete and rename dialogs. */
export interface BoardWorkspaceMenuController {
	archive: (workspace: WorkspaceShellModel) => void;
	openDelete: (workspace: WorkspaceShellModel) => void;
	openRename: (workspace: WorkspaceShellModel) => void;
}

/** Context carrying the board's shared workspace-menu controller to cards. */
const BoardWorkspaceMenuContext =
	createContext<BoardWorkspaceMenuController | null>(null);

/**
 * Provides the board workspace-menu controller to descendant cards so each card
 * reads it directly instead of receiving it threaded through column props.
 */
export function BoardWorkspaceMenuProvider({
	children,
	controller,
}: {
	children: ReactNode;
	controller: BoardWorkspaceMenuController;
}) {
	return (
		<BoardWorkspaceMenuContext.Provider value={controller}>
			{children}
		</BoardWorkspaceMenuContext.Provider>
	);
}

/**
 * Reads the board workspace-menu controller from context.
 * @returns The controller a card calls to open its lifecycle dialogs.
 * @throws When called outside a `BoardWorkspaceMenuProvider`.
 */
export function useBoardWorkspaceMenuController(): BoardWorkspaceMenuController {
	const controller = useContext(BoardWorkspaceMenuContext);
	if (controller === null) {
		throw new Error(
			'useBoardWorkspaceMenuController must be used within a BoardWorkspaceMenuProvider',
		);
	}
	return controller;
}

/**
 * Owns the delete and rename dialog state for the dashboard board so every card
 * can trigger the same workspace lifecycle actions the sidebar uses, without
 * each card mounting its own dialogs. Archiving needs no dialog of its own — it
 * runs straight from the card and escalates to the shell's archive dialog only
 * for the archives that cannot be taken back.
 * @returns A controller the cards call plus the dialog node to mount once.
 */
export function useBoardWorkspaceMenu(): {
	controller: BoardWorkspaceMenuController;
	dialogs: ReactNode;
} {
	const [deleteTarget, setDeleteTarget] = useState<WorkspaceShellModel | null>(
		null,
	);
	const [renameTarget, setRenameTarget] = useState<WorkspaceShellModel | null>(
		null,
	);

	const handleWorkspaceLifecycleAction = useRemoveWorkspaceAction({
		activeWorkspaceId: null,
	});
	const archiveWorkspace = useArchiveWorkspaceAction({
		activeWorkspaceId: null,
	});

	const controller = useMemo<BoardWorkspaceMenuController>(
		() => ({
			archive: (workspace) => {
				void archiveWorkspace(workspace);
			},
			openDelete: setDeleteTarget,
			openRename: setRenameTarget,
		}),
		[archiveWorkspace],
	);

	const dialogs = (
		<>
			<DeleteWorkspaceDialog
				onDeleted={handleWorkspaceLifecycleAction.deleted}
				onOpenChange={(open) => {
					if (!open) {
						setDeleteTarget(null);
					}
				}}
				open={deleteTarget !== null}
				workspace={deleteTarget}
			/>
			<RenameWorkspaceDialog
				onOpenChange={(open) => {
					if (!open) {
						setRenameTarget(null);
					}
				}}
				open={renameTarget !== null}
				workspace={renameTarget}
			/>
		</>
	);

	return { controller, dialogs };
}
