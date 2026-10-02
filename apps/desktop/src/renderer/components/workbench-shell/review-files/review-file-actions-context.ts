import { createContext, use } from 'react';

import type { ReviewFileActions } from '@/renderer/types/workbench';

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
