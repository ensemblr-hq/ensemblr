/**
 * Hands a plan Claude submitted through its own `ExitPlanMode` tool to the same
 * plan-submission service Pi reaches through `ensemblr_exit_plan_mode`, so both
 * runtimes save the plan under `.context/plans/`, post it into the chat, and
 * raise the one review panel the renderer already renders.
 *
 * Claude never calls the control op — it is withheld from its MCP tool list, and
 * `PLAN_MODE_GUARDED_TOOLS` names Pi's tools — so this is the whole of Claude's
 * plan path, and it starts from the adapter's event stream rather than an
 * inbound control request.
 */
import type { ExitPlanModeArgs } from '../../shared/agent-control.ts';
import type { AgentControlOrigin } from '../agent-control/ports.ts';
import type { ClaudePlanSubmittedEvent } from './claude-plan-mode.ts';

/** Collaborators for {@link createClaudePlanBridge}. */
export interface ClaudePlanBridgeOptions {
	/** Resolves the trusted origin behind a session's control bearer token. */
	resolveOrigin: (token: string) => AgentControlOrigin | null;
	/** Saves the plan, posts it into the chat, and raises the review panel. */
	submitPlan: (input: {
		origin: AgentControlOrigin;
		args: ExitPlanModeArgs;
	}) => Promise<unknown>;
}

/**
 * Builds the adapter's `onPlanSubmitted` handler.
 *
 * A submission whose token resolves to no origin is dropped rather than filed
 * against a synthesised one: `submit` writes the plan file into
 * `origin.workspaceCwd`, so an invented origin would put a plan somewhere the
 * user never looks — or somewhere they did not consent to a write.
 * @param options - Origin lookup and the plan-submission entry point.
 * @returns The handler to pass to `createClaudeAgentAdapter`.
 */
export function createClaudePlanBridge({
	resolveOrigin,
	submitPlan,
}: ClaudePlanBridgeOptions): (event: ClaudePlanSubmittedEvent) => void {
	return ({ agentSessionId, controlToken, submission }) => {
		const origin = controlToken ? resolveOrigin(controlToken) : null;
		if (!origin) {
			console.warn(
				`[claude-agent] dropped a submitted plan: session ${agentSessionId} has no registered control origin.`,
			);
			return;
		}

		void submitPlan({
			args: { plan: submission.plan, title: submission.title },
			origin,
		}).catch((cause: unknown) => {
			console.warn('[claude-agent] failed to file a submitted plan', cause);
		});
	};
}
