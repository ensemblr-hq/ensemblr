import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useEffect, useMemo } from 'react';

import {
	reportConciergeVisibility,
	subscribeToConciergeEvents,
} from '@/renderer/api/ensemblr';
import { pendingAskUserQuestionsAtom } from '@/renderer/state/ask-user-question';
import {
	clearConciergeActivity,
	conciergeActivityAtom,
	conciergePresentationAtom,
	conciergeStreamingAtom,
	isConciergeAgentMessage,
	isConciergeStreamingStatus,
	noteConciergeMessage,
	setConciergeQuestion,
} from '@/renderer/state/concierge';
import type { AskUserQuestionBroadcast } from '@/shared/agent-control';

/**
 * Picks the Concierge's questionnaire out of the map every agent's lands in.
 *
 * An empty workspace id is the marker: the Concierge is the one agent that
 * belongs to no workspace, which is the same fact `useAutoMarkUnread` uses to
 * leave it alone and `notifyQuestionRaised` uses to notify under its own name.
 * Keyed on that rather than on the open session's id, because a window reloaded
 * mid-conversation has no session id yet while the Concierge is still blocked.
 * @param pending - Every questionnaire waiting on the user, by session id.
 * @returns The Concierge's question, or null when it is not blocked.
 */
function findConciergeQuestion(
	pending: Readonly<Record<string, AskUserQuestionBroadcast>>,
): AskUserQuestionBroadcast | null {
	return (
		Object.values(pending).find((question) => question.workspaceId === '') ??
		null
	);
}

/**
 * Watches the Concierge from above every route, so the launcher bubble can say
 * what happened while its panel was shut.
 *
 * Mounted at the app root rather than beside the launcher, because
 * `/_workbench/settings/*` is a sibling of the shell layout the launcher lives
 * in: a subscription owned by the launcher would go deaf exactly while the user
 * is somewhere the badge is the only way to find out that a turn landed.
 *
 * The presentation is read out of the store at event time rather than taken as
 * a dependency, following `useAutoMarkUnread`: a dependency would tear the
 * subscription down and rebuild it on every open and close, and an event landing
 * in that gap would be lost.
 *
 * Only the live session is watched. The stream also carries the turn a retired
 * child runs to write its memories after a context clear, and this window may
 * never have opened the panel, so it holds no session id of its own to compare
 * against — the broadcast's own `live` flag is the only thing here that can tell
 * the two apart.
 *
 * Opening the panel is the only thing that marks the Concierge read — the
 * transcript on screen is the report — which is why the clear is derived from
 * the presentation rather than run from the toggle.
 */
export function useConciergeActivityWatch(): void {
	const store = useStore();
	const setActivity = useSetAtom(conciergeActivityAtom);
	const setStreaming = useSetAtom(conciergeStreamingAtom);
	const presentation = useAtomValue(conciergePresentationAtom);
	const pendingQuestions = useAtomValue(pendingAskUserQuestionsAtom);
	const question = useMemo(
		() => findConciergeQuestion(pendingQuestions),
		[pendingQuestions],
	);
	const isClosed = presentation === 'closed';

	useEffect(
		() =>
			subscribeToConciergeEvents(
				({ event, live, sessionId: eventSessionId }) => {
					if (!live) {
						return;
					}
					const payload = event.payload;
					if (payload?.kind === 'status') {
						setStreaming(isConciergeStreamingStatus(payload.status));
						return;
					}
					// A child that dies mid-turn emits this and no trailing `idle`, so
					// without it the bubble would orbit for a turn nothing is running.
					if (payload?.kind === 'shutdown') {
						setStreaming(false);
						return;
					}
					if (
						store.get(conciergePresentationAtom) === 'closed' &&
						isConciergeAgentMessage(payload)
					) {
						setActivity((state) => noteConciergeMessage(state, eventSessionId));
					}
				},
			),
		[setActivity, setStreaming, store],
	);

	useEffect(() => {
		if (!isClosed) {
			setActivity(clearConciergeActivity);
			return;
		}
		setActivity((state) =>
			setConciergeQuestion(
				state,
				question?.agentSessionId ?? null,
				question !== null,
			),
		);
	}, [isClosed, question, setActivity]);

	useEffect(() => {
		reportConciergeVisibility(!isClosed);
	}, [isClosed]);
}
