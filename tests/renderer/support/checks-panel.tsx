// Render harness for the review Checks panel. It needs a jotai store and the
// review-actions context on top of what `renderWithProviders` supplies, and the
// `ReviewActionsValue` stub is the part worth writing once — a new field on that
// type should break one file, not every panel test.

import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { vi } from 'vitest';

import { ChecksPanel } from '@/renderer/components/workbench-shell/checks-panel/checks-panel';
import { ReviewActionsContextProvider } from '@/renderer/components/workbench-shell/review-actions/review-actions-context';
import type {
	ReviewActionsValue,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { createTestQueryClient } from './dom';

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
		pushBranch: vi.fn(),
		refreshPullRequest: vi.fn(),
		runAgentAction: vi.fn(),
		...overrides,
	};
}

/**
 * Renders the Checks panel for a workspace. `switchTo` re-renders it for another
 * workspace against the same query cache and store, which is how a test asserts
 * that per-workspace state does not leak across a navigation.
 */
export function renderChecksPanel(
	workspace: WorkspaceShellModel,
	reviewActions: ReviewActionsValue = stubReviewActions(),
) {
	const queryClient = createTestQueryClient();
	const store = createStore();
	const panel = (active: WorkspaceShellModel) => (
		<Provider store={store}>
			<QueryClientProvider client={queryClient}>
				<ReviewActionsContextProvider value={reviewActions}>
					<ChecksPanel workspace={active} />
				</ReviewActionsContextProvider>
			</QueryClientProvider>
		</Provider>
	);
	const view = render(panel(workspace));
	return {
		...view,
		switchTo: (next: WorkspaceShellModel) => view.rerender(panel(next)),
	};
}
