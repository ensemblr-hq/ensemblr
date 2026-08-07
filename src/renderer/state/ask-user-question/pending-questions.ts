/**
 * Renderer half of the `askUserQuestion` round trip: keeps the pending-question
 * map in step with the main process, and answers a question on the user's
 * behalf, which unblocks the agent that asked it.
 */
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';

import type {
	AskUserQuestionAnswer,
	AskUserQuestionBroadcast,
} from '@/shared/agent-control';
import { pendingAskUserQuestionsAtom } from './atoms.ts';

/**
 * Returns the map without the entry for a request id, or the same map when the
 * request is not pending.
 * @param pending - Current pending map.
 * @param requestId - Request to drop.
 * @returns The map without that request.
 */
function withoutRequest(
	pending: Readonly<Record<string, AskUserQuestionBroadcast>>,
	requestId: string,
): Readonly<Record<string, AskUserQuestionBroadcast>> {
	const sessionId = Object.keys(pending).find(
		(key) => pending[key]?.requestId === requestId,
	);
	if (sessionId === undefined) {
		return pending;
	}
	const next = { ...pending };
	delete next[sessionId];
	return next;
}

/**
 * Subscribes the pending-question map to main-process broadcasts. Mount once at
 * the app root; questions arrive for every chat tab, not just the visible one.
 */
export function useAskUserQuestionSync(): void {
	const setPending = useSetAtom(pendingAskUserQuestionsAtom);
	useEffect(() => {
		const unsubscribeAsk = window.ensemblr?.onAskUserQuestion((payload) => {
			setPending((pending) => ({
				...pending,
				[payload.agentSessionId]: payload,
			}));
		});
		const unsubscribeClosed = window.ensemblr?.onAskUserQuestionClosed(
			({ requestId }) => {
				setPending((pending) => withoutRequest(pending, requestId));
			},
		);
		return () => {
			unsubscribeAsk?.();
			unsubscribeClosed?.();
		};
	}, [setPending]);
}

/**
 * Reads the questionnaire a chat tab must show, if any.
 * @param agentSessionId - Session backing the chat tab, or null when it has none.
 * @returns The pending questionnaire, or null.
 */
export function usePendingAskUserQuestion(
	agentSessionId: string | null,
): AskUserQuestionBroadcast | null {
	const pending = useAtomValue(pendingAskUserQuestionsAtom);
	return agentSessionId === null ? null : (pending[agentSessionId] ?? null);
}

/**
 * Returns a callback that answers a pending questionnaire and clears it, so the
 * dialog disappears as soon as the user acts rather than waiting on the agent.
 */
export function useAnswerUserQuestion(): (input: {
	requestId: string;
	answers: readonly AskUserQuestionAnswer[];
	cancelled: boolean;
}) => void {
	const setPending = useSetAtom(pendingAskUserQuestionsAtom);
	return useCallback(
		({ answers, cancelled, requestId }) => {
			setPending((pending) => withoutRequest(pending, requestId));
			void window.ensemblr?.answerUserQuestion({
				answers,
				cancelled,
				requestId,
			});
		},
		[setPending],
	);
}
