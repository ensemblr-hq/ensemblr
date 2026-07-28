/**
 * The bottom slot of a chat surface. Normally the composer; while an agent is
 * blocked on `ask_user_question` it becomes that questionnaire instead, so the
 * user answers where the agent asked rather than hunting for a dialog.
 *
 * A finished plan rides *above* the composer instead of replacing it: the agent
 * has already stopped, the plan is the message right above, and refining it
 * means typing into that same composer.
 */
import { useCallback } from 'react';

import { AskUserQuestionCard } from '@/renderer/components/ask-user-question';
import { usePlanReview } from '@/renderer/hooks/workbench-shell/conversation-panel/use-plan-review';
import {
	useAnswerUserQuestion,
	usePendingAskUserQuestion,
} from '@/renderer/state/ask-user-question';
import type {
	ComposerShellState,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { AskUserQuestionAnswer } from '@/shared/agent-control';
import { ComposerPanel } from './composer-panel';
import { PlanReviewPanel } from './plan-review-panel';

/** Renders the pending agent question for this chat, or the composer. */
export function ComposerSlot({
	chatTabId,
	composer,
	piSessionId,
	seedText,
	workspace,
}: {
	chatTabId: string;
	composer: ComposerShellState;
	piSessionId: string | null;
	seedText?: string;
	workspace: WorkspaceShellModel;
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

	const plan = usePlanReview({
		chatTabId,
		onPlanModeChange: composer.onPlanModeChange,
		onSubmit: composer.onSubmit,
		piSessionId,
		workspace,
	});

	if (pendingQuestion) {
		return (
			<AskUserQuestionCard
				key={pendingQuestion.requestId}
				onFinish={finishQuestion}
				questions={pendingQuestion.questions}
			/>
		);
	}
	return (
		<ComposerPanel
			chatTabId={chatTabId}
			composer={composer}
			planReview={
				plan.review ? (
					<PlanReviewPanel
						busy={plan.isHandingOff}
						key={plan.review.requestId}
						onApprove={plan.approve}
						onHandoff={plan.handOff}
						onRefine={plan.refine}
						title={plan.review.title}
					/>
				) : null
			}
			seedText={seedText}
		/>
	);
}
