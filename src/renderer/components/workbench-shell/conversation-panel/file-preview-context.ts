import { createContext, use } from 'react';

import type {
	PullRequestCommentSummary,
	ReviewFilePreviewOpener,
	WorkspaceFileDiffOpener,
} from '@/renderer/types/workbench';

/**
 * Opens (or re-focuses) a file-preview tab for a workspace-relative path.
 * Provided by the conversation surface; consumed by attachment chips rendered
 * deep inside the timeline. `null` outside a workspace conversation, so chips
 * degrade to their non-interactive form.
 */
type FilePreviewOpener = (filePath: string) => void;

const FilePreviewOpenerContext = createContext<FilePreviewOpener | null>(null);

export const FilePreviewOpenerProvider = FilePreviewOpenerContext.Provider;

/**
 * Read the file-preview opener from context.
 * @returns The opener, or null outside a workspace conversation.
 */
export function useFilePreviewOpener(): FilePreviewOpener | null {
	return use(FilePreviewOpenerContext);
}

/** Opens (or re-focuses) a diff tab for a checkpointed turn. */
type TurnDiffOpener = (input: { label: string; turnId: string }) => void;

const TurnDiffOpenerContext = createContext<TurnDiffOpener | null>(null);

export const TurnDiffOpenerProvider = TurnDiffOpenerContext.Provider;

/**
 * Read the turn-diff opener from context.
 * @returns The opener, or null when no provider is present.
 */
export function useTurnDiffOpener(): TurnDiffOpener | null {
	return use(TurnDiffOpenerContext);
}

const WorkspaceFileDiffOpenerContext =
	createContext<WorkspaceFileDiffOpener | null>(null);

export const WorkspaceFileDiffOpenerProvider =
	WorkspaceFileDiffOpenerContext.Provider;

/**
 * Read the workspace file-diff opener from context.
 * @returns The opener, or null when no provider is present.
 */
export function useWorkspaceFileDiffOpener(): WorkspaceFileDiffOpener | null {
	return use(WorkspaceFileDiffOpenerContext);
}

const ReviewFilePreviewOpenerContext =
	createContext<ReviewFilePreviewOpener | null>(null);

export const ReviewFilePreviewOpenerProvider =
	ReviewFilePreviewOpenerContext.Provider;

/**
 * Read the review file-preview opener from context.
 * @returns The opener, or null when no provider is present.
 */
export function useReviewFilePreviewOpener(): ReviewFilePreviewOpener | null {
	return use(ReviewFilePreviewOpenerContext);
}

/**
 * Opens (or re-focuses) a read-only PR-comment preview tab in the main surface.
 * Provided at the workbench level so the Checks panel (right sidebar) can open
 * the preview alongside file/diff tabs; `null` outside a workspace.
 */
type CommentPreviewOpener = (input: {
	comment: PullRequestCommentSummary;
	prNumber?: number;
}) => void;

const CommentPreviewOpenerContext = createContext<CommentPreviewOpener | null>(
	null,
);

export const CommentPreviewOpenerProvider =
	CommentPreviewOpenerContext.Provider;

/**
 * Read the PR-comment preview opener from context.
 * @returns The opener, or null outside a workspace.
 */
export function useCommentPreviewOpener(): CommentPreviewOpener | null {
	return use(CommentPreviewOpenerContext);
}
