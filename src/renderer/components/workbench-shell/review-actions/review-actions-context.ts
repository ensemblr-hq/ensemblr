import { createContext, use } from 'react';

import type { AgentActionKind } from '@/renderer/lib/workbench/agent-actions';

/**
 * Review-flow actions shared by the right sidebar header and the Checks panel.
 * Provided by `ReviewActionsProvider` at the workspace shell level so any
 * review surface can open the commit/PR/merge dialogs or force a gh refresh.
 */
export interface ReviewActionsValue {
	isRefreshingPullRequest: boolean;
	openCommitAndPush: () => void;
	openCreatePullRequest: (options?: { draft?: boolean }) => void;
	openMergeConfirmation: () => void;
	refreshPullRequest: () => void;
	/** Inserts the resolved agent-action prompt into the composer (ENS-059). */
	runAgentAction: (action: AgentActionKind) => void;
}

const ReviewActionsContext = createContext<ReviewActionsValue | null>(null);

export const ReviewActionsContextProvider = ReviewActionsContext.Provider;

export function useReviewActions(): ReviewActionsValue | null {
	return use(ReviewActionsContext);
}
