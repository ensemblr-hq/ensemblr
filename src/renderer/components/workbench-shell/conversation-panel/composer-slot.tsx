/**
 * The bottom slot of a chat surface. Normally the composer; while an agent is
 * blocked on `ask_user_question` it becomes that questionnaire instead, and
 * while a Claude tool call is blocked on approval it becomes that card — so the
 * user answers where the agent asked rather than hunting for a dialog.
 *
 * A finished plan rides as the composer's own header instead of replacing it:
 * the agent has already stopped, the plan is the message right above, and
 * refining it means typing into that same composer.
 */
import { useCallback } from 'react';

import { AskUserQuestionCard } from '@/renderer/components/ask-user-question';
import { ToolApprovalCard } from '@/renderer/components/tool-approval';
import { usePlanReview } from '@/renderer/hooks/workbench-shell/conversation-panel/use-plan-review';
import { usePendingQuestionCard } from '@/renderer/state/ask-user-question';
import {
	useAnswerToolApproval,
	usePendingToolApproval,
} from '@/renderer/state/tool-approval';
import type {
	ComposerShellState,
	WorkspaceLinkedIssueSummary,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { ToolApprovalDecision } from '@/shared/agent-tool-approval';
import { ComposerPanel } from './composer-panel';
import { PlanReviewPanel } from './plan-review-panel';

/** Renders the pending agent question for this chat, or the composer. */
export function ComposerSlot({
	chatTabId,
	composer,
	agentSessionId,
	seedLinkedIssue,
	workspace,
}: {
	chatTabId: string;
	composer: ComposerShellState;
	agentSessionId: string | null;
	/** Issue an issue-created workspace came from, attached to the draft once. */
	seedLinkedIssue?: WorkspaceLinkedIssueSummary;
	workspace: WorkspaceShellModel;
}) {
	const questionCard = usePendingQuestionCard(agentSessionId);

	const pendingApproval = usePendingToolApproval(agentSessionId);
	const answerToolApproval = useAnswerToolApproval();
	const approvalRequestId = pendingApproval?.requestId ?? null;
	const decideApproval = useCallback(
		(decision: ToolApprovalDecision) => {
			if (approvalRequestId !== null && agentSessionId !== null) {
				answerToolApproval({
					agentSessionId,
					decision,
					requestId: approvalRequestId,
				});
			}
		},
		[agentSessionId, answerToolApproval, approvalRequestId],
	);

	const plan = usePlanReview({
		chatTabId,
		onPlanModeChange: composer.onPlanModeChange,
		onSubmit: composer.onSubmit,
		agentSessionId,
		workspace,
	});

	if (questionCard) {
		return (
			<AskUserQuestionCard
				key={questionCard.requestId}
				onFinish={questionCard.onFinish}
				questions={questionCard.questions}
			/>
		);
	}
	if (pendingApproval) {
		return (
			<ToolApprovalCard
				key={pendingApproval.requestId}
				onDecide={decideApproval}
				request={pendingApproval}
			/>
		);
	}
	return (
		<ComposerPanel
			chatTabId={chatTabId}
			composer={composer}
			repositoryId={workspace.projectId}
			planReview={
				plan.review ? (
					<PlanReviewPanel
						busy={plan.isHandingOff}
						key={plan.review.requestId}
						onApprove={plan.approve}
						onHandoff={plan.handOff}
						onRefine={plan.refine}
					/>
				) : null
			}
			seedLinkedIssue={seedLinkedIssue}
			workspaceId={workspace.id}
		/>
	);
}
