/**
 * The questionnaire the Concierge is blocked on, in the panel the user is
 * already looking at.
 *
 * The pending map is keyed by the agent session that asked, and the Concierge's
 * session is a perfectly good key — what it lacked was a reader. Only the
 * workbench's `ComposerSlot` looked one up, and it looks up a chat tab's
 * session, so a Concierge question sat in the map with nothing rendering it
 * while the agent blocked on an ask that has no timeout.
 *
 * It sits above the composer rather than replacing it, which is where the two
 * surfaces differ: a chat tab's draft lives in an atom and survives the swap,
 * while the Concierge composer holds its draft in the editor itself, so
 * unmounting it to make room would throw away whatever the user had typed.
 */
import { AskUserQuestionCard } from '@/renderer/components/ask-user-question';
import { usePendingQuestionCard } from '@/renderer/state/ask-user-question';

/** Renders the Concierge's pending question, or nothing when it has none. */
export function ConciergeQuestionSlot({
	agentSessionId,
}: {
	agentSessionId: string | null;
}) {
	const card = usePendingQuestionCard(agentSessionId);

	if (!card) {
		return null;
	}

	return (
		<AskUserQuestionCard
			key={card.requestId}
			onFinish={card.onFinish}
			questions={card.questions}
		/>
	);
}
