/**
 * The bottom slot of a chat surface. Normally the composer; while an agent is
 * blocked on `ask_user_question` it becomes that questionnaire instead, so the
 * user answers where the agent asked rather than hunting for a dialog.
 */
import { useCallback } from 'react';

import { AskUserQuestionCard } from '@/renderer/components/ask-user-question';
import {
	useAnswerUserQuestion,
	usePendingAskUserQuestion,
} from '@/renderer/state/ask-user-question';
import type { ComposerShellState } from '@/renderer/types/workbench';
import type { AskUserQuestionAnswer } from '@/shared/agent-control';
import { ComposerPanel } from './composer-panel';

/** Renders the pending agent question for this chat, or the composer. */
export function ComposerSlot({
	chatTabId,
	composer,
	piSessionId,
	seedText,
}: {
	chatTabId: string;
	composer: ComposerShellState;
	piSessionId: string | null;
	seedText?: string;
}) {
	const pendingQuestion = usePendingAskUserQuestion(piSessionId);
	const answerUserQuestion = useAnswerUserQuestion();
	const requestId = pendingQuestion?.requestId ?? null;
	const finishQuestion = useCallback(
		(input: {
			answers: readonly AskUserQuestionAnswer[];
			cancelled: boolean;
		}) => {
			if (requestId !== null) {
				answerUserQuestion({ ...input, requestId });
			}
		},
		[answerUserQuestion, requestId],
	);

	if (!pendingQuestion) {
		return (
			<ComposerPanel
				chatTabId={chatTabId}
				composer={composer}
				seedText={seedText}
			/>
		);
	}
	return (
		<AskUserQuestionCard
			key={pendingQuestion.requestId}
			onFinish={finishQuestion}
			questions={pendingQuestion.questions}
		/>
	);
}
