import { useCallback } from 'react';

import { useMenuCommand } from '@/renderer/state/menu-commands';
import type { ReviewActionsValue } from '@/renderer/types/workbench';

/**
 * Registers the Changes menu, the only keyboard-reachable path to the review
 * flow — commit, push, PR, merge, and the agent actions that were previously
 * buttons inside the collapsible right sidebar.
 *
 * Every item is gated on `isAgentWorking` for the same reason the buttons are:
 * the agent is about to change the state these actions would act on.
 * @param actions - The review action bundle the provider publishes
 */
export function useReviewMenuCommands(actions: ReviewActionsValue): void {
	const {
		commitAndPush,
		isAgentWorking,
		openMergeConfirmation,
		pushBranch,
		runAgentAction,
	} = actions;

	const review = useCallback(() => runAgentAction('review'), [runAgentAction]);
	const createPullRequest = useCallback(
		() => runAgentAction('create-pr'),
		[runAgentAction],
	);
	const resolveConflicts = useCallback(
		() => runAgentAction('resolve-conflicts'),
		[runAgentAction],
	);
	const fixCheckErrors = useCallback(
		() => runAgentAction('fix-check-errors'),
		[runAgentAction],
	);

	const enabled = !isAgentWorking;

	useMenuCommand('review.review', review, enabled);
	useMenuCommand('review.commitAndPush', commitAndPush, enabled);
	useMenuCommand('review.pushBranch', pushBranch, enabled);
	useMenuCommand('review.createPullRequest', createPullRequest, enabled);
	useMenuCommand('review.mergePullRequest', openMergeConfirmation, enabled);
	useMenuCommand('review.resolveConflicts', resolveConflicts, enabled);
	useMenuCommand('review.fixCheckErrors', fixCheckErrors, enabled);
}
