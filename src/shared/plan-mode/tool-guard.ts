/**
 * Plan Mode's tool policy: which agent tool calls are blocked while a
 * conversation is planning, and the reason handed back to the model. The Pi
 * extension asks the app over the control server rather than deciding locally,
 * so this classifier is the single place the policy lives.
 */
import { isReadOnlyBashCommand } from './bash-guard.ts';
import { planModeBlockReason } from './block-reason.ts';

/** The tool call being classified: its name, plus the command for `bash`. */
export interface PlanModeToolRequest {
	tool: string;
	command?: string;
}

/** Whether a tool call may proceed, and why not when it may not. */
export interface PlanModeToolVerdict {
	blocked: boolean;
	reason?: string;
}

/**
 * Wraps the shared block reason in a verdict.
 * @param cause - What about this call is not allowed while planning.
 * @returns The blocked verdict carrying the full reason.
 */
function blocked(cause: string): PlanModeToolVerdict {
	return { blocked: true, reason: planModeBlockReason(cause) };
}

/**
 * Classifies a tool call against Plan Mode policy: `write` and `edit` are
 * always blocked, `bash` is restricted to read-only commands, and every other
 * tool is untouched.
 * @param request - The tool name and, for `bash`, the command it would run.
 * @returns Whether the call is blocked, with a reason when it is.
 */
export function evaluatePlanModeTool({
	command,
	tool,
}: PlanModeToolRequest): PlanModeToolVerdict {
	if (tool === 'write' || tool === 'edit') {
		return blocked(
			`\`${tool}\` cannot change files until the plan is approved`,
		);
	}
	if (tool !== 'bash') {
		return { blocked: false };
	}
	const verdict = isReadOnlyBashCommand(command ?? '');
	return verdict.ok
		? { blocked: false }
		: blocked(`this \`bash\` command is not read-only: ${verdict.reason}`);
}
