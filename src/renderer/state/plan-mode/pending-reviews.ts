/**
 * Renderer half of the `exitPlanMode` hand-off: keeps the pending-review map in
 * step with the main process, and drops a review once the user decides.
 *
 * Nothing is waiting on the decision — the agent already ended its turn — so
 * dismissal is purely local. What the user chose reaches the agent as its next
 * prompt, or as a fresh chat tab for a handoff.
 */
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';

import type { ExitPlanModeBroadcast } from '@/shared/agent-control';
import { pendingPlanReviewsAtom } from './atoms.ts';

/**
 * Subscribes the pending-review map to main-process broadcasts. Mount once at
 * the app root; plans arrive for every chat tab, not just the visible one.
 */
export function usePlanReviewSync(): void {
	const setPending = useSetAtom(pendingPlanReviewsAtom);
	useEffect(() => {
		const unsubscribe = window.ensemblr?.onExitPlanMode((payload) => {
			setPending((pending) => ({ ...pending, [payload.piSessionId]: payload }));
		});
		return () => unsubscribe?.();
	}, [setPending]);
}

/**
 * Reads the plan a chat tab must put to the user, if any.
 * @param piSessionId - Session backing the chat tab, or null when it has none.
 * @returns The pending plan review, or null.
 */
export function usePendingPlanReview(
	piSessionId: string | null,
): ExitPlanModeBroadcast | null {
	const pending = useAtomValue(pendingPlanReviewsAtom);
	return piSessionId === null ? null : (pending[piSessionId] ?? null);
}

/**
 * Returns a callback that clears a chat's plan review once the user has acted
 * on it, so the panel disappears the moment they decide.
 */
export function useDismissPlanReview(): (piSessionId: string) => void {
	const setPending = useSetAtom(pendingPlanReviewsAtom);
	return useCallback(
		(piSessionId) => {
			setPending((pending) => {
				if (!(piSessionId in pending)) {
					return pending;
				}
				const next = { ...pending };
				delete next[piSessionId];
				return next;
			});
		},
		[setPending],
	);
}
