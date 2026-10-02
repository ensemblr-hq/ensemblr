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
import { isEnsemblrControlTool } from '../agent-control.ts';
import { isReadOnlyBashCommand } from './bash-guard.ts';
import { planModeBlockReason } from './block-reason.ts';
import {
	isVouchedByUser,
	KNOWN_READ_ONLY_EXTENSION_TOOLS,
} from './tool-trust.ts';

/**
 * The tool call being classified: its name, the command for `bash`, and the
 * tools the user vouches for as read-only on the calling runtime.
 */
export interface PlanModeToolRequest {
	tool: string;
	command?: string;
	trustedTools?: ReadonlySet<string>;
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
 * Pi's read-only built-in tools, cleared without a policy of their own. The
 * known read-only extension tools and the user's own list clear beside them;
 * see `tool-trust.ts`.
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
 * Wraps the shared block reason in a verdict.
 * @param cause - What about this call is not allowed while planning.
 * @returns The blocked verdict carrying the full reason.
 */
function blocked(cause: string): PlanModeToolVerdict {
	return { blocked: true, reason: planModeBlockReason(cause) };
}

/**
 * Reports whether a tool needs no plan-mode opinion of its own.
 *
 * Ensemblr's own control tools clear here because they are gated somewhere
 * better: `planModeControlOpDenial` answers for each one by op and by the
 * caller's role, and a blanket denial from this classifier would take away the
 * reads and the spawn route that planning is *for*. `isEnsemblrControlTool`
 * rather than a prefix test, because a harness reaching those tools over MCP
 * sees every one of them namespaced by the server that serves them.
 * @param tool - The tool name being classified.
 * @returns True for a read-only built-in, a known read-only extension tool, or an Ensemblr control tool.
 */
function runsUntouchedWhilePlanning(tool: string): boolean {
	return (
		PLAN_MODE_READ_ONLY_TOOLS.has(tool) ||
		KNOWN_READ_ONLY_EXTENSION_TOOLS.has(tool) ||
		isEnsemblrControlTool(tool)
	);
}

/**
 * Classifies a tool call against Plan Mode policy: `write` and `edit` are always
 * blocked, `bash` is restricted to read-only commands, Pi's read-only built-ins,
 * the known read-only extension tools, Ensemblr's own control tools, and the
 * tools the user vouches for run untouched, and **anything else is blocked**.
 *
 * Deny by default, for the reason the bash classifier is an allowlist. The tool
 * set a Pi session holds is open: the user can install another extension or
 * point Pi at an MCP server, and a write tool arriving that way would otherwise
 * be the one call no policy ever saw. A false block costs the agent a turn and
 * a reason it can read; a false allow edits the repository Plan Mode exists to
 * hold still. The user's own list is consulted last, so it clears a tool this
 * module has no opinion about and never overturns the write or `bash` verdict.
 * @param request - The tool name, for `bash` the command it would run, and the user's trusted tools.
 * @returns Whether the call is blocked, with a reason when it is.
 */
export function evaluatePlanModeTool({
	command,
	tool,
	trustedTools,
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
	if (runsUntouchedWhilePlanning(tool) || isVouchedByUser(tool, trustedTools)) {
		return { blocked: false };
	}
	return blocked(
		`\`${tool}\` is not a tool Plan Mode knows to be read-only, so it is refused rather than guessed at — a tool from an MCP server or another extension can write files just as \`write\` does. Read with \`read\`, \`grep\`, \`find\` and \`ls\`, and put the rest in the plan; if this tool comes from an extension or an MCP server and the user knows it cannot change anything, they can trust it under Settings → Providers → Read-only tools`,
	);
}
