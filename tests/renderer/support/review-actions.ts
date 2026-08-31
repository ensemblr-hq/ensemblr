// The one `ReviewActionsValue` stub every review-surface test builds on. It
// lives apart from the Checks-panel harness so a header test can reach it
// without importing the panel, and so a new field on the type breaks one file
// rather than every test that renders a review surface.

import { vi } from 'vitest';

import type { ReviewActionsValue } from '@/renderer/types/workbench';

/** Review actions that record calls and do nothing, overridable per test. */
export function stubReviewActions(
	overrides: Partial<ReviewActionsValue> = {},
): ReviewActionsValue {
	return {
		archiveMergedWorkspace: vi.fn(),
		commitAndPush: vi.fn(),
		continueMergedWorkspace: vi.fn(),
		handOffToChat: vi.fn(() => true),
		isAgentWorking: false,
		isArchivingMergedWorkspace: false,
		isContinuingMergedWorkspace: false,
		isPushingBranch: false,
		isRefreshingPullRequest: false,
		openMergeConfirmation: vi.fn(),
		pullRequestAction: 'create-pr',
		pushBranch: vi.fn(),
		refreshPullRequest: vi.fn(),
		runAgentAction: vi.fn(),
		...overrides,
	};
}
