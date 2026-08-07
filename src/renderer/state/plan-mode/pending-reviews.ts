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
			setPending((pending) => ({
				...pending,
				[payload.agentSessionId]: payload,
			}));
		});
		return () => unsubscribe?.();
	}, [setPending]);
}

/**
 * Reads the plan a chat tab must put to the user, if any.
 * @param agentSessionId - Session backing the chat tab, or null when it has none.
 * @returns The pending plan review, or null.
 */
export function usePendingPlanReview(
	agentSessionId: string | null,
): ExitPlanModeBroadcast | null {
	const pending = useAtomValue(pendingPlanReviewsAtom);
	return agentSessionId === null ? null : (pending[agentSessionId] ?? null);
}

/**
 * Returns a callback that clears a chat's plan review once the user has acted
 * on it, so the panel disappears the moment they decide.
 */
export function useDismissPlanReview(): (agentSessionId: string) => void {
	const setPending = useSetAtom(pendingPlanReviewsAtom);
	return useCallback(
		(agentSessionId) => {
			setPending((pending) => {
				if (!(agentSessionId in pending)) {
					return pending;
				}
				const next = { ...pending };
				delete next[agentSessionId];
				return next;
			});
		},
		[setPending],
	);
}
