/**
 * The widening both deny-by-default tool policies share: tools vouched for as
 * read-only beyond each runtime's own built-ins, whether by this app or by the
 * user.
 *
 * Plan Mode and the Concierge ask the same question of a tool they do not know —
 * can it change anything? — so they share one answer here. A leaf module, so both
 * guards can import it without importing each other.
 */
import type { AgentProviderId } from '../agent-provider.ts';

/**
 * An MCP tool as Claude Code names it, `mcp__<server>__<tool>`, with the server
 * captured — the only kind of Claude Code tool a user may vouch for.
 */
export const CLAUDE_MCP_TOOL_NAME = /^mcp__(.+?)__./;

/**
 * Which names each runtime lets a user vouch for at all, before any policy is
 * consulted. Keyed by runtime so a new one has to decide rather than inherit.
 *
 * Claude Code's own built-ins are the app's to classify, not the user's: the
 * read-only ones are cleared already, and the rest act — `Monitor` runs a
 * command the bash classifier never sees, `EnterWorktree` moves git, `Workflow`
 * spawns agents that write — so a switch in Settings must not be able to clear
 * one. What a Claude session adds beyond its built-ins arrives over MCP, so an
 * MCP tool is what the list is for there. Pi's built-ins are all classified or
 * never trusted, and everything else it holds comes from an extension.
 */
const TRUSTABLE_NAME: Record<AgentProviderId, (tool: string) => boolean> = {
	/** Admits only an MCP tool. */
	claude: (tool) => CLAUDE_MCP_TOOL_NAME.test(tool),
	/** Admits any extension tool; the policies below sort out the built-ins. */
	pi: () => true,
};

/**
 * Reports whether a runtime lets a user vouch for a tool of this name at all.
 * @param tool - The tool name.
 * @param runtime - The runtime the tool belongs to.
 * @returns True when the name is of a kind the runtime leaves to the user.
 */
export function hasTrustableName(
	tool: string,
	runtime: AgentProviderId,
): boolean {
	return TRUSTABLE_NAME[runtime](tool);
}

/**
 * The web tools a Pi session holds, cleared by both policies so an agent that
 * may not write can still research, the way a Claude session does with its own
 * `WebSearch` and `WebFetch`.
 *
 * Pi ships no web tool of its own; these are the default names `pi-web-access`
 * registers. None of them can reach a workspace: search results and fetched
 * pages land in Pi's own cache, and a cloned GitHub repository or an extracted
 * PDF lands in a temp directory the call has no parameter to move. A user who
 * renames them in `pi-web-access`'s config gets the default denial back, which
 * is the direction a name-based policy has to fail in.
 */
export const KNOWN_READ_ONLY_EXTENSION_TOOLS: ReadonlySet<string> = new Set([
	'fetch_content',
	'get_search_content',
	'source_check',
	'web_search',
]);

/**
 * Tool names no user trust clears, because what each one does is decided by
 * its arguments rather than its name, so vouching for the name vouches for
 * everything behind it.
 *
 * Pi's `powershell` runs a shell the bash classifier cannot read — it is the one
 * built-in that falls to the default denial rather than to a policy of its own.
 * `mcp` and `mcpScript` are `pi-mcp-adapter`'s dispatchers: the first calls any
 * tool on any configured MCP server and the second runs a script that can call
 * them all, writers included. A read-only MCP tool is trusted by its own name
 * once the adapter registers it directly (its `directTools` setting).
 */
export const NEVER_TRUSTED_TOOLS: ReadonlySet<string> = new Set([
	'mcp',
	'mcpScript',
	'powershell',
]);

/**
 * Reports whether the user has vouched for a tool as read-only.
 *
 * Each guard consults it only after its write and shell policies have answered,
 * so it widens the default denial and nothing else: a trusted `bash` still meets
 * the bash classifier, and a trusted `write` still meets the path check.
 * @param tool - The tool name being classified.
 * @param trustedTools - The names the user trusts for the calling runtime.
 * @returns True when the name is on the user's list and no trust is barred for it.
 */
export function isVouchedByUser(
	tool: string,
	trustedTools: ReadonlySet<string> | undefined,
): boolean {
	return trustedTools?.has(tool) === true && !NEVER_TRUSTED_TOOLS.has(tool);
}
