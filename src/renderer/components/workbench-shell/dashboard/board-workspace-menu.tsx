import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useState,
} from 'react';

import { useArchiveWorkspaceAction } from '@/renderer/hooks/workbench-shell/navigation-sidebar/use-project-navigation-actions';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

import { ArchiveWorkspaceDialog } from '../archive-workspace-dialog';
import { DeleteWorkspaceDialog } from '../delete-workspace-dialog';
import { RenameWorkspaceDialog } from '../rename-workspace-dialog';

/** No-op standing in for the sidebar-only reorder animation suppression. */
const noop = () => undefined;

/** Per-workspace openers for the board card's archive, delete, and rename dialogs. */
export interface BoardWorkspaceMenuController {
	openArchive: (workspace: WorkspaceShellModel) => void;
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
 * Owns the archive, delete, and rename dialog state for the dashboard board so
 * every card can trigger the same workspace lifecycle actions the sidebar uses,
 * without each card mounting its own dialogs.
 * @returns A controller the cards call plus the dialog node to mount once.
 */
export function useBoardWorkspaceMenu(): {
	controller: BoardWorkspaceMenuController;
	dialogs: ReactNode;
} {
	const [archiveTarget, setArchiveTarget] =
		useState<WorkspaceShellModel | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<WorkspaceShellModel | null>(
		null,
	);
	const [renameTarget, setRenameTarget] = useState<WorkspaceShellModel | null>(
		null,
	);

	const handleWorkspaceLifecycleAction = useArchiveWorkspaceAction({
		activeWorkspaceId: null,
		disableProjectReorderLayoutAnimation: noop,
	});

	const controller = useMemo<BoardWorkspaceMenuController>(
		() => ({
			openArchive: setArchiveTarget,
			openDelete: setDeleteTarget,
			openRename: setRenameTarget,
		}),
		[],
	);

	const dialogs = (
		<>
			<ArchiveWorkspaceDialog
				onArchived={handleWorkspaceLifecycleAction}
				onOpenChange={(open) => {
					if (!open) {
						setArchiveTarget(null);
					}
				}}
				open={archiveTarget !== null}
				workspace={archiveTarget}
			/>
			<DeleteWorkspaceDialog
				onDeleted={handleWorkspaceLifecycleAction}
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
