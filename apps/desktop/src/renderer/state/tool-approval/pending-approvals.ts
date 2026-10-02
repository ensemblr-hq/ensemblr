/**
 * Renderer half of the tool-approval round trip: keeps the pending-prompt map in
 * step with the main process, and answers a prompt on the user's behalf, which
 * unblocks the Claude tool call waiting on it.
 */
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';

import type {
	ToolApprovalDecision,
	ToolApprovalRequestedBroadcast,
} from '@/shared/agent-tool-approval';
import { pendingToolApprovalsAtom } from './atoms.ts';

/**
 * Returns the map without the entry for a request id, or the same map when the
 * request is not pending.
 * @param pending - Current pending map.
 * @param requestId - Request to drop.
 * @returns The map without that request.
 */
function withoutRequest(
	pending: Readonly<Record<string, ToolApprovalRequestedBroadcast>>,
	requestId: string,
): Readonly<Record<string, ToolApprovalRequestedBroadcast>> {
	const agentSessionId = Object.keys(pending).find(
		(key) => pending[key]?.requestId === requestId,
	);
	if (agentSessionId === undefined) {
		return pending;
	}
	const next = { ...pending };
	delete next[agentSessionId];
	return next;
}

/**
 * Subscribes the pending-prompt map to main-process broadcasts. Mount once at
 * the app root; prompts arrive for every chat tab, not just the visible one.
 */
export function useToolApprovalSync(): void {
	const setPending = useSetAtom(pendingToolApprovalsAtom);
	useEffect(() => {
		const unsubscribeRequested = window.ensemblr?.onAgentToolApprovalRequested(
			(payload) => {
				setPending((pending) => ({
					...pending,
					[payload.agentSessionId]: payload,
				}));
			},
		);
		const unsubscribeClosed = window.ensemblr?.onAgentToolApprovalClosed(
			({ requestId }) => {
				setPending((pending) => withoutRequest(pending, requestId));
			},
		);
		return () => {
			unsubscribeRequested?.();
			unsubscribeClosed?.();
		};
	}, [setPending]);
}

/**
 * Reads the tool call a chat tab must put to the user, if any.
 * @param agentSessionId - Session backing the chat tab, or null when it has none.
 * @returns The pending prompt, or null.
 */
export function usePendingToolApproval(
	agentSessionId: string | null,
): ToolApprovalRequestedBroadcast | null {
	const pending = useAtomValue(pendingToolApprovalsAtom);
	return agentSessionId === null ? null : (pending[agentSessionId] ?? null);
}

/**
 * Returns a callback that answers a pending prompt and clears it, so the card
 * disappears as soon as the user decides rather than waiting on the round trip.
 * The answer names its session, which main checks against the request it holds
 * so one chat can never settle another chat's prompt.
 */
export function useAnswerToolApproval(): (input: {
	agentSessionId: string;
	requestId: string;
	decision: ToolApprovalDecision;
}) => void {
	const setPending = useSetAtom(pendingToolApprovalsAtom);
	return useCallback(
		({ agentSessionId, decision, requestId }) => {
			setPending((pending) => withoutRequest(pending, requestId));
			void window.ensemblr?.agentToolApprovalAnswered({
				agentSessionId,
				decision,
				requestId,
			});
		},
		[setPending],
	);
}
