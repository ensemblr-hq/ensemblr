/**
 * Plan Mode's tool policy: which agent tool calls are blocked while a
 * conversation is planning, and the reason handed back to the model. The Pi
 * extension asks the app over the control server rather than deciding locally,
 * so this classifier is the single place the policy lives.
 *
 * Deny by default. The extension forwards every tool call it does not already
 * know to be a read, so an unknown name reaches here rather than running
 * unclassified, and this module refuses what it cannot vouch for.
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
 * The Pi built-in tools Plan Mode has a *specific* opinion about: `write` and
 * `edit` are always blocked, and `bash` is restricted to read-only commands.
 * Everything outside this set is answered by
 * {@link PLAN_MODE_READ_ONLY_TOOLS} or refused — the policy is an allowlist, so
 * a name missing here is denied rather than waved through.
 *
 * This still MUST list every built-in Pi tool that can mutate the repository,
 * because these are the names whose denial says something useful about what the
 * tool does. The shipped extension embeds a byte-identical copy (it cannot
 * import from `src/` at runtime); a parity test keeps the two in step. Add a new
 * Pi mutation tool here and in that copy together.
 */
export const PLAN_MODE_GUARDED_TOOLS: ReadonlySet<string> = new Set([
	'bash',
	'edit',
	'write',
]);

/**
 * Pi's read-only built-in tools, the only names cleared without a policy of
 * their own.
 *
 * This is Pi's whole non-mutating built-in set as of 0.85: its tool modules
 * declare `bash`, `edit`, `find`, `grep`, `ls`, `powershell`, `read` and
 * `write`, of which the first, second and last are in
 * {@link PLAN_MODE_GUARDED_TOOLS} and `powershell` runs a shell this module's
 * bash classifier cannot read — so it is deliberately absent and falls to the
 * default denial.
 */
const PLAN_MODE_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
	'find',
	'grep',
	'ls',
	'read',
]);

/**
 * Prefix of Ensemblr's own control tools, which are cleared here because they
 * are gated somewhere better: `planModeControlOpDenial` answers for each one by
 * op and by the caller's role, and a blanket denial from this classifier would
 * take away the reads and the spawn route that planning is *for*.
 */
const CONTROL_TOOL_PREFIX = 'ensemblr_';

/**
 * Wraps the shared block reason in a verdict.
 * @param cause - What about this call is not allowed while planning.
 * @returns The blocked verdict carrying the full reason.
 */
function blocked(cause: string): PlanModeToolVerdict {
	return { blocked: true, reason: planModeBlockReason(cause) };
}

/**
 * Reports whether a tool needs no plan-mode opinion of its own.
 * @param tool - The tool name being classified.
 * @returns True for a read-only built-in or an Ensemblr control tool.
 */
function runsUntouchedWhilePlanning(tool: string): boolean {
	return (
		PLAN_MODE_READ_ONLY_TOOLS.has(tool) || tool.startsWith(CONTROL_TOOL_PREFIX)
	);
}

/**
 * Classifies a tool call against Plan Mode policy: `write` and `edit` are always
 * blocked, `bash` is restricted to read-only commands, Pi's read-only built-ins
 * and Ensemblr's own control tools run untouched, and **anything else is
 * blocked**.
 *
 * Deny by default, for the reason the bash classifier is an allowlist. The tool
 * set a Pi session holds is open: the user can install another extension or
 * point Pi at an MCP server, and a write tool arriving that way would otherwise
 * be the one call no policy ever saw. A false block costs the agent a turn and
 * a reason it can read; a false allow edits the repository Plan Mode exists to
 * hold still.
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
	if (tool === 'bash') {
		const verdict = isReadOnlyBashCommand(command ?? '');
		return verdict.ok
			? { blocked: false }
			: blocked(`this \`bash\` command is not read-only: ${verdict.reason}`);
	}
	if (runsUntouchedWhilePlanning(tool)) {
		return { blocked: false };
	}
	return blocked(
		`\`${tool}\` is not a tool Plan Mode knows to be read-only, so it is refused rather than guessed at — a tool from an MCP server or another extension can write files just as \`write\` does. Read with \`read\`, \`grep\`, \`find\` and \`ls\`, and put the rest in the plan`,
	);
}
