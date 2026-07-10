import { createContext, use } from 'react';

import type { AgentActionKind } from '@/renderer/lib/workbench/agent-actions';

/**
 * Review-flow actions shared by the right sidebar header and the Checks panel.
 * Provided by `ReviewActionsProvider` at the workspace shell level so any
 * review surface can open the merge confirmation, force a gh refresh, or run an
 * agent action. PR creation is handed to the chat agent (see
 * `CreatePullRequestMenu`), so it is no longer a context action.
 */
export interface ReviewActionsValue {
	isRefreshingPullRequest: boolean;
	openMergeConfirmation: () => void;
	refreshPullRequest: () => void;
	/** Inserts the resolved agent-action prompt into the composer (ENS-059). */
	runAgentAction: (action: AgentActionKind) => void;
}

const ReviewActionsContext = createContext<ReviewActionsValue | null>(null);

export const ReviewActionsContextProvider = ReviewActionsContext.Provider;

/**
 * Read the review-flow actions from context.
 * @returns The review actions, or null outside a ReviewActionsProvider.
 */
export function useReviewActions(): ReviewActionsValue | null {
	return use(ReviewActionsContext);
}
