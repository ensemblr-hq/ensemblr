// Render harness for the review Checks panel. It needs a jotai store and the
// review-actions context on top of what `renderWithProviders` supplies. The
// `ReviewActionsValue` stub lives in `./review-actions` and is re-exported here
// for the panel tests that already import it from this module.

import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';

import { ChecksPanel } from '@/renderer/components/workbench-shell/checks-panel/checks-panel';
import { ReviewActionsContextProvider } from '@/renderer/components/workbench-shell/review-actions/review-actions-context';
import type {
	ReviewActionsValue,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { createTestQueryClient } from './dom';
import { stubReviewActions } from './review-actions';

export { stubReviewActions };

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
