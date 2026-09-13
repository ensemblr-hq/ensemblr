/**
 * The names Ensemblr's own control tools answer to, and the check that
 * recognizes one whatever naming scheme the calling runtime wraps it in.
 *
 * The two first-class runtimes disagree about what to call the same tool. Pi
 * loads the control extension in-process and calls it `ensemblr_list_models`;
 * Claude Code reaches the same server over MCP, where the SDK namespaces every
 * tool by its server and calls it `mcp__ensemblr__ensemblr_list_models`. A
 * `startsWith('ensemblr_')` test sees only the first, which is how the Concierge
 * guard came to refuse every control tool a Claude Concierge held.
 *
 * Membership rather than a prefix, because the guards that ask this question
 * clear what it answers yes to: an unrelated MCP server's tool that merely
 * carried the prefix would be waved past a policy meant to refuse it. The name
 * has to be a control tool this app actually serves, and the whole wrapper in
 * front of it has to be one this app serves that tool under.
 *
 * Whole wrapper, not its last segment: a server name may itself contain the
 * separator, so `mcp__other__ensemblr__ensemblr_start_terminal` ends in an
 * `ensemblr` segment while naming a server that is not ours. Matching the
 * accepted prefixes entire is what keeps a third-party server from borrowing
 * the clearance.
 */
import { AGENT_CONTROL_OPS } from './contracts.ts';

/** Prefix every control tool name carries, under every runtime. */
const CONTROL_TOOL_PREFIX = 'ensemblr_';

/**
 * MCP server name the control tools are registered under, shared by every
 * runtime that reaches the server over MCP so the `ensemblr_*` names in the
 * awareness playbooks resolve identically whichever one reads them.
 */
export const CONTROL_SERVER_NAME = 'ensemblr';

/**
 * Renders one op identifier as the tool name it is served under.
 * @param op - Camel-case control op identifier.
 * @returns The snake-case tool name, prefix included.
 */
function toolNameForOp(op: string): string {
	return `${CONTROL_TOOL_PREFIX}${op.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`;
}

/**
 * Every control tool name, derived from the op list rather than restated, so a
 * new op is covered the moment it is declared.
 *
 * A superset of what the MCP endpoint registers: the ops the Pi extension calls
 * internally have no tool of their own. That costs nothing here — the control
 * server still answers for each op by role before it runs.
 */
const CONTROL_TOOL_NAMES: ReadonlySet<string> = new Set(
	AGENT_CONTROL_OPS.map(toolNameForOp),
);

/**
 * Every wrapper a runtime may put in front of a control tool name, in full.
 *
 * The empty string is Pi, which loads the extension in-process and reports the
 * registered name unwrapped. The rest are the forms a client that reaches the
 * server over MCP produces: the `mcp__<server>__` the Claude Agent SDK builds,
 * and the bare server segment other clients prepend under either separator.
 */
const ACCEPTED_NAMESPACE_PREFIXES: readonly string[] = [
	'',
	`${CONTROL_SERVER_NAME}__`,
	`${CONTROL_SERVER_NAME}.`,
	`mcp__${CONTROL_SERVER_NAME}__`,
];

/**
 * Resolves the name a runtime reported to the name the control server registered
 * the tool under, or null when it is not one of this app's control tools.
 * @param toolName - The tool name as the runtime reported it.
 * @returns The registered control tool name, or null when the name is not one.
 */
export function bareEnsemblrControlToolName(toolName: string): string | null {
	for (const prefix of ACCEPTED_NAMESPACE_PREFIXES) {
		if (!toolName.startsWith(prefix)) {
			continue;
		}
		const bareName = toolName.slice(prefix.length);
		if (CONTROL_TOOL_NAMES.has(bareName)) {
			return bareName;
		}
	}
	return null;
}

/**
 * Reports whether a tool name is one of Ensemblr's own control tools, under
 * either the bare name Pi reports or the namespaced form an MCP client wraps it
 * in.
 * @param toolName - The tool name as the runtime reported it.
 * @returns True when the name resolves to a control tool served by this app.
 */
export function isEnsemblrControlTool(toolName: string): boolean {
	return bareEnsemblrControlToolName(toolName) !== null;
}
