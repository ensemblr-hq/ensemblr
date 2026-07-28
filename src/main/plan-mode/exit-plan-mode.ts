/**
 * Hand-off point between a planning agent and the human. `exitPlanMode` saves
 * the plan under `.context/plans/`, puts the review panel in front of the user,
 * and returns immediately telling the agent to stop.
 *
 * It deliberately does NOT block on the user's decision. A blocking call would
 * park the turn with the agent still "working", pushing the plan out of the
 * last-message slot and freezing the composer while the user reads. Ending the
 * turn instead leaves the plan as the last thing said; the decision reaches the
 * agent as its next prompt.
 */
import { randomUUID } from 'node:crypto';

import type {
	ExitPlanModeArgs,
	ExitPlanModeBroadcast,
	ExitPlanModeResult,
} from '../../shared/agent-control.ts';
import { buildPlanSubmittedResult } from '../../shared/agent-control.ts';
import type { AgentControlOrigin } from '../agent-control/ports.ts';
import type { PlanFileWriter } from './plan-file-writer.ts';

/** Collaborators for {@link createPlanSubmission}. */
interface PlanSubmissionOptions {
	/** Pushes a finished plan to every renderer window. */
	broadcastReview: (payload: ExitPlanModeBroadcast) => void;
	/** Whether any window is available to host the review panel. */
	hasRenderer: () => boolean;
	/** Writes the plan markdown so the agent never needs the blocked `write` tool. */
	planFileWriter: PlanFileWriter;
	/** Overrides request-id minting; defaults to a random UUID. */
	createRequestId?: () => string;
}

/** Public surface of the plan-submission service. */
export interface PlanSubmission {
	/** Saves the plan, shows it to the user, and tells the agent to stop. */
	submit: (input: {
		origin: AgentControlOrigin;
		args: ExitPlanModeArgs;
	}) => Promise<ExitPlanModeResult>;
}

/** Told to the agent when no window exists to render the review panel. */
const NO_RENDERER_SUMMARY =
	'No Ensemblr window was available to show the plan, so the user never saw the review panel. Plan Mode is still on. Stop here and leave the plan as your last message; the user will pick it up when they reopen the app.';

/**
 * Creates the plan-submission service.
 * @param options - Broadcast hook, renderer availability, the plan writer, and
 *   id minting.
 * @returns The entry point the agent-control service delegates `exitPlanMode` to.
 */
export function createPlanSubmission({
	broadcastReview,
	createRequestId = randomUUID,
	hasRenderer,
	planFileWriter,
}: PlanSubmissionOptions): PlanSubmission {
	/**
	 * Saves the plan markdown, degrading to an in-message plan when the write
	 * fails rather than losing the review entirely.
	 * @param origin - Resolved caller identity, for the workspace path.
	 * @param args - The submitted title and plan.
	 * @returns The workspace-relative path, or null when the write failed.
	 */
	const savePlan = async (
		origin: AgentControlOrigin,
		args: ExitPlanModeArgs,
	): Promise<string | null> => {
		try {
			return await planFileWriter.writePlanFile({
				piSessionId: origin.sessionId,
				plan: args.plan,
				title: args.title,
				workspaceCwd: origin.workspaceCwd,
				workspaceId: origin.workspaceId,
			});
		} catch (error) {
			console.warn('[plan-mode] failed to write plan file', error);
			return null;
		}
	};

	return {
		submit: async ({ args, origin }) => {
			const planPath = await savePlan(origin, args);
			if (!hasRenderer()) {
				return { planPath, summary: NO_RENDERER_SUMMARY };
			}
			broadcastReview({
				piSessionId: origin.sessionId,
				planPath,
				requestId: createRequestId(),
				title: args.title,
				workspaceId: origin.workspaceId,
			});
			return buildPlanSubmittedResult(planPath);
		},
	};
}
