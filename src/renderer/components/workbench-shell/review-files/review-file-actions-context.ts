import { createContext, use } from 'react';

import type { WorkspaceFileDiffOpener } from '@/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import type { OpenTargetsState } from '@/renderer/hooks/workbench-shell/use-open-targets';
import type { WorkspaceOpenTarget } from '@/renderer/types/workbench';

/**
 * Per-row actions shared by every changed-file row and the single right-click
 * menu. Carried through React context rather than props because the folder tree
 * is recursive — threading five callbacks through every `ReviewDirectoryBranch`
 * would be noise, and the bundle is stable for the lifetime of a change set.
 */
export interface ReviewFileActions {
	/** Installed "Open in <app>" targets (copy-path excluded), or empty when none. */
	openInTargets: readonly WorkspaceOpenTarget[];
	/** The copy-path target, if available. */
	copyTarget: WorkspaceOpenTarget | undefined;
	/** Runs the chosen open-in/copy target against a workspace-relative file path. */
	invokeTarget: OpenTargetsState['invokeTarget'];
	/** Opens (or re-focuses) the diff for a file at the active source's scope. `null` outside a conversation. */
	openDiff: WorkspaceFileDiffOpener | null;
	/** Discards the working-tree changes for a single file. */
	onDiscardFile: (filePath: string) => void;
	/**
	 * Whether a file can be discarded in the current view. Only working-tree
	 * (uncommitted) files revert cleanly; committed-only files in the branch or
	 * a specific-commit view are not discardable.
	 */
	isDiscardable: (filePath: string) => boolean;
}

const ReviewFileActionsContext = createContext<ReviewFileActions | null>(null);

export const ReviewFileActionsProvider = ReviewFileActionsContext.Provider;

/**
 * Reads the changed-file action bundle. Throws when used outside the provider so
 * a missing wrapper surfaces immediately instead of as silently dead buttons.
 */
export function useReviewFileActions(): ReviewFileActions {
	const actions = use(ReviewFileActionsContext);
	if (!actions) {
		throw new Error(
			'useReviewFileActions must be used within a ReviewFileActionsProvider',
		);
	}
	return actions;
}
