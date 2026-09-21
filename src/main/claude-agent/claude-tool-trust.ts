/**
 * What a Claude Code session needs from the user's read-only tool list, and how
 * its tool list is described for the inventory Settings offers from.
 *
 * The list is the same one the Pi path consults over the control server — only
 * the runtime key differs — so a Claude Concierge and a planning Claude chat
 * clear exactly the tools the user vouched for on this runtime.
 */
import type { ReportToolInventoryArgs } from '../../shared/agent-control.ts';
import { CLAUDE_MCP_TOOL_NAME } from '../../shared/plan-mode.ts';

/**
 * The user's read-only tool list for Claude Code, read per tool call so a change
 * in Settings reaches the next call, plus the two sinks that feed the Settings
 * list: the tools a session's `init` reports and the ones a guard refused.
 */
export interface ClaudeToolTrust {
	trustedTools: () => ReadonlySet<string>;
	recordInventory: (tools: ReportToolInventoryArgs['tools']) => void;
	recordRefusal: (tool: string) => void;
}

/**
 * Describes the tool names a Claude session's `init` lists in the shape the
 * inventory keeps. An MCP tool is attributed to its server; a built-in gets no
 * source, since the inventory drops every built-in anyway, and `init` carries
 * no descriptions, so none is invented.
 * @param names - The tool names `init` listed.
 * @returns One inventory row per name.
 */
export function describeClaudeTools(
	names: readonly string[],
): ReportToolInventoryArgs['tools'] {
	return names.map((name) => ({
		description: null,
		name,
		source: CLAUDE_MCP_TOOL_NAME.exec(name)?.[1] ?? null,
	}));
}
