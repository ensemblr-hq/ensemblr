import { atom } from 'jotai';

import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/** Which lifecycle dialog the Workspace menu asked for, and for which workspace. */
export interface WorkspaceLifecycleDialogRequest {
	kind: 'archive' | 'delete' | 'rename';
	workspace: WorkspaceShellModel;
}

/**
 * The Workspace menu's open lifecycle dialog, or null when none is.
 *
 * Shell-scoped rather than owned by the workspace view that raises it: archiving
 * or deleting the active workspace unmounts that view, and a Radix modal
 * destroyed by an ancestor unmount never runs the cleanup that releases
 * `pointer-events` on `<body>`, which strands the whole front end.
 */
export const workspaceLifecycleDialogAtom =
	atom<WorkspaceLifecycleDialogRequest | null>(null);

/** Whether the GitHub clone dialog is currently mounted-open. */
export const cloneDialogOpenAtom = atom<boolean>(false);

/** Whether the quick-start dialog is currently mounted-open. */
export const quickStartDialogOpenAtom = atom<boolean>(false);

/** Whether the local-project import progress dialog is currently shown. */
export const localProjectImportDialogOpenAtom = atom<boolean>(false);
