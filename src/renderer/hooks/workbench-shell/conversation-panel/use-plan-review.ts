import { useCallback } from 'react';

import { useRequestComposerFocus } from '@/renderer/state/composer';
import {
	useDismissPlanReview,
	usePendingPlanReview,
} from '@/renderer/state/plan-mode';
import type {
	ComposerSubmitOutcome,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type { ExitPlanModeBroadcast } from '@/shared/agent-control';
import { usePlanHandoff } from './use-plan-handoff';

/** Prompt sent on approval, so the agent's next turn starts on the plan. */
const APPROVAL_PROMPT = 'Approved — implement the plan.';

/** What a chat needs to put a finished plan to the user. */
interface PlanReviewInput {
	chatTabId: string;
	onPlanModeChange: (planMode: boolean) => void;
	onSubmit: (prompt: string) => Promise<ComposerSubmitOutcome>;
	agentSessionId: string | null;
	workspace: WorkspaceShellModel;
}

/** The pending plan, if any, plus the three ways the user can answer it. */
interface PlanReview {
	approve: () => void;
	handOff: () => void;
	/** True while the handoff chat tab is being created. */
	isHandingOff: boolean;
	refine: () => void;
	review: ExitPlanModeBroadcast | null;
}

/**
 * Wires a chat's pending plan review to the three decisions. The agent has
 * already ended its turn by the time a plan arrives, so none of these answer a
 * blocked call: approve turns Plan Mode off and starts the implementation turn,
 * refine hands the user back their own composer with Plan Mode still on, and
 * hand off moves the plan into a fresh chat.
 *
 * Both answers that end planning tell the main process so directly. Approve's
 * prompt would carry the toggle anyway; hand off sends no prompt, and a session
 * main still believes is planning keeps its tools gated and greets an
 * orchestrator's follow-up with the "resubmit your plan" directive.
 * @param input - Chat identity, composer callbacks, and the owning workspace.
 * @returns The pending review and its decision handlers.
 */
export function usePlanReview({
	chatTabId,
	onPlanModeChange,
	onSubmit,
	agentSessionId,
	workspace,
}: PlanReviewInput): PlanReview {
	const review = usePendingPlanReview(agentSessionId);
	const dismissPlanReview = useDismissPlanReview();
	const requestComposerFocus = useRequestComposerFocus();
	const { handOff, isHandingOff } = usePlanHandoff(workspace);
	const reviewSessionId = review?.agentSessionId ?? null;
	const planPath = review?.planPath ?? null;
	const planTitle = review?.title ?? null;

	const approve = useCallback(() => {
		if (reviewSessionId === null) {
			return;
		}
		onPlanModeChange(false);
		dismissPlanReview(reviewSessionId);
		void onSubmit(APPROVAL_PROMPT);
	}, [dismissPlanReview, onPlanModeChange, onSubmit, reviewSessionId]);

	const refine = useCallback(() => {
		if (reviewSessionId === null) {
			return;
		}
		dismissPlanReview(reviewSessionId);
		requestComposerFocus(chatTabId);
	}, [chatTabId, dismissPlanReview, requestComposerFocus, reviewSessionId]);

	const handOffPlan = useCallback(() => {
		if (reviewSessionId === null || planTitle === null) {
			return;
		}
		void handOff({ planPath, title: planTitle }).then((handoffChatTabId) => {
			if (handoffChatTabId === null) {
				return;
			}
			onPlanModeChange(false);
			// Approve carries the new toggle to main on the prompt it submits; this
			// one submits nothing to this session, so main would keep treating it as
			// planning with a plan still awaiting a decision.
			void window.ensemblr?.setAgentPlanMode({
				planMode: false,
				sessionId: reviewSessionId,
			});
			dismissPlanReview(reviewSessionId);
		});
	}, [
		dismissPlanReview,
		handOff,
		onPlanModeChange,
		planPath,
		planTitle,
		reviewSessionId,
	]);

	return { approve, handOff: handOffPlan, isHandingOff, refine, review };
}
