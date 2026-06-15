import { createContext, use } from 'react';

/**
 * Opens (or re-focuses) a file-preview tab for a workspace-relative path.
 * Provided by the conversation surface; consumed by attachment chips rendered
 * deep inside the timeline. `null` outside a workspace conversation, so chips
 * degrade to their non-interactive form.
 */
export type FilePreviewOpener = (filePath: string) => void;

const FilePreviewOpenerContext = createContext<FilePreviewOpener | null>(null);

export const FilePreviewOpenerProvider = FilePreviewOpenerContext.Provider;

export function useFilePreviewOpener(): FilePreviewOpener | null {
	return use(FilePreviewOpenerContext);
}

/** Opens (or re-focuses) a diff tab for a checkpointed turn. */
export type TurnDiffOpener = (input: { label: string; turnId: string }) => void;

const TurnDiffOpenerContext = createContext<TurnDiffOpener | null>(null);

export const TurnDiffOpenerProvider = TurnDiffOpenerContext.Provider;

export function useTurnDiffOpener(): TurnDiffOpener | null {
	return use(TurnDiffOpenerContext);
}

/**
 * Opens (or re-focuses) a working-tree diff tab for a changed file. Provided
 * at the workbench level so the review panel (right sidebar) can open diffs
 * in the main conversation surface.
 */
export type WorkspaceFileDiffOpener = (filePath: string) => void;

const WorkspaceFileDiffOpenerContext =
	createContext<WorkspaceFileDiffOpener | null>(null);

export const WorkspaceFileDiffOpenerProvider =
	WorkspaceFileDiffOpenerContext.Provider;

export function useWorkspaceFileDiffOpener(): WorkspaceFileDiffOpener | null {
	return use(WorkspaceFileDiffOpenerContext);
}

/** Opens (or re-focuses) a read-only file preview tab from review surfaces. */
export type ReviewFilePreviewOpener = (filePath: string) => void;

const ReviewFilePreviewOpenerContext =
	createContext<ReviewFilePreviewOpener | null>(null);

export const ReviewFilePreviewOpenerProvider =
	ReviewFilePreviewOpenerContext.Provider;

export function useReviewFilePreviewOpener(): ReviewFilePreviewOpener | null {
	return use(ReviewFilePreviewOpenerContext);
}
