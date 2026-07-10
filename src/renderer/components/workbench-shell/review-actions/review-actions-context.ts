import { createContext, use } from 'react';

import type { ReviewActionsValue } from '@/renderer/types/workbench';

const ReviewActionsContext = createContext<ReviewActionsValue | null>(null);

export const ReviewActionsContextProvider = ReviewActionsContext.Provider;

/**
 * Read the review-flow actions from context.
 * @returns The review actions, or null outside a ReviewActionsProvider.
 */
export function useReviewActions(): ReviewActionsValue | null {
	return use(ReviewActionsContext);
}
