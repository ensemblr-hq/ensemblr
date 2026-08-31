import type { ReviewActionsValue } from '@/renderer/types/workbench';

/**
 * Every action a review surface reads, stubbed to do nothing. Shared by the
 * scenes that mount a review surface only to look at it, so a new field on
 * `ReviewActionsValue` lands in one place rather than in each preview.
 */
export const IDLE_REVIEW_ACTIONS: ReviewActionsValue = {
	archiveMergedWorkspace: () => undefined,
	commitAndPush: () => undefined,
	continueMergedWorkspace: () => undefined,
	handOffToChat: () => true,
	isAgentWorking: false,
	isArchivingMergedWorkspace: false,
	isContinuingMergedWorkspace: false,
	isPushingBranch: false,
	isRefreshingPullRequest: false,
	openMergeConfirmation: () => undefined,
	pullRequestAction: 'create-pr',
	pushBranch: () => undefined,
	refreshPullRequest: () => undefined,
	runAgentAction: () => undefined,
};
