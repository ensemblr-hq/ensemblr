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
 *
 * {@link namespaceControlToolNames} is the same disagreement pointed outward.
 * Every playbook, directive, tool description, and op result names these tools
 * in Pi's bare spelling, because Pi's extension is where they are registered
 * unwrapped — but a Claude agent handed that prose holds
 * `mcp__ensemblr__ensemblr_set_name` and nothing called `ensemblr_set_name`, so
 * it reads a few hundred names it cannot call and calls one anyway. Rewriting
 * happens on the way out, per caller, so the literals themselves stay bare and
 * the Pi extension's byte-identical copies of them keep passing parity.
 */
import type { AgentProviderId } from '../agent-provider.ts';
import { AGENT_CONTROL_OPS, type AgentControlOp } from './contracts.ts';

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

/**
 * How a caller's client spells the control tools in the list it hands its model.
 * `bare` is the registered name itself; `mcp` is that name under the wrapper an
 * MCP client builds in front of it.
 */
export type ControlToolNaming = 'bare' | 'mcp';

/**
 * Runtimes that reach the control server through an MCP client of their own, and
 * so hold every control tool under that client's namespace rather than under the
 * name the server registered. Pi is absent because it loads the shipped
 * extension in-process, which registers the bare names directly.
 *
 * One declaration for one fact with three consequences: which runtimes need the
 * loopback endpoint handed to them at session open, which see wrapped tool
 * names, and which therefore need the prose they are handed rewritten.
 */
export const MCP_CLIENT_RUNTIMES: ReadonlySet<AgentProviderId> = new Set([
	'claude',
]);

/**
 * The naming scheme a caller sees, from the runtime it is itself running on.
 * @param runtime - The caller's runtime, or null when the app cannot name one — a terminal harness, whose MCP client is unknown.
 * @returns The scheme its tool list spells control tools under.
 */
export function controlToolNamingForRuntime(
	runtime: AgentProviderId | null,
): ControlToolNaming {
	return runtime !== null && MCP_CLIENT_RUNTIMES.has(runtime) ? 'mcp' : 'bare';
}

/** The wrapper each naming scheme puts in front of a registered tool name. */
const NAMESPACE_BY_NAMING: Record<ControlToolNaming, string> = {
	bare: '',
	mcp: `mcp__${CONTROL_SERVER_NAME}__`,
};

/**
 * Matches a candidate control tool name in prose. The leading word boundary is
 * what keeps an already-wrapped name from being wrapped twice: `_` is a word
 * character, so there is no boundary before the `ensemblr_…` inside
 * `mcp__ensemblr__ensemblr_set_name`.
 */
const CANDIDATE_TOOL_NAME = /\bensemblr_[a-z0-9_]+/g;

/**
 * Rewrites every control tool name in agent-facing prose to the spelling the
 * receiving client's tool list actually carries, leaving every other word alone.
 *
 * A candidate that is not a control tool this app serves is left as written, so
 * an unknown or misspelled name fails as itself rather than acquiring a wrapper
 * that makes it look served.
 * @param text - Agent-facing prose written in the bare spelling.
 * @param naming - The receiving caller's naming scheme.
 * @returns The prose with control tool names spelled for that caller.
 */
export function namespaceControlToolNames(
	text: string,
	naming: ControlToolNaming,
): string {
	const namespace = NAMESPACE_BY_NAMING[naming];
	if (namespace === '') {
		return text;
	}
	return text.replace(CANDIDATE_TOOL_NAME, (candidate) =>
		CONTROL_TOOL_NAMES.has(candidate) ? `${namespace}${candidate}` : candidate,
	);
}

/**
 * Ops whose result carries text the app read from somewhere else and must hand
 * back exactly as it found it, so {@link namespaceControlToolNames} is never
 * applied to them.
 *
 * The rewrite is for prose the app wrote: guidance naming the next op to call.
 * These ops return a git patch, terminal scrollback, a transcript, a stored
 * document, or a ticket somebody else typed — where a control tool name is a
 * fact about that content rather than a recommendation to the reader. Rewriting
 * one hands an agent a diff that disagrees with the file on disk, or a transcript
 * naming a tool the child never called, and a stored diagram read through the
 * rewrite is written back corrupted. Ensemblr is developed in Ensemblr, so its
 * own source is the content most likely to carry these names.
 *
 * A child's report is deliberately absent. `getLastMessage` and `waitForAgents`
 * return prose one agent wrote for another, which is the case the rewrite exists
 * for: a Pi child naming a tool bare is naming it for a parent that may hold the
 * wrapped form.
 */
export const VERBATIM_RESULT_OPS: ReadonlySet<AgentControlOp> = new Set([
	'getArchitectureDiagram',
	'getDiffComments',
	'getWorkspaceDiff',
	'linearGetIssue',
	'linearListIssues',
	'readConversation',
	'readTerminalOutput',
	'recallMemory',
]);
