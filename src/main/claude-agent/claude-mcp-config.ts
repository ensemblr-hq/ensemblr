import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

import {
	CONTROL_TOKEN_ENV_KEY,
	envVarReference,
} from '../agent-control/control-env-keys.ts';
import type { AgentControlMcpConfig } from '../agent-runtime/agent-types.ts';

/**
 * Server name the Ensemblr Control tools are registered under. Matches the name
 * the terminal harnesses use, so the `ensemblr_*` tool names in the awareness
 * playbooks resolve identically whichever runtime reads them.
 */
const CONTROL_SERVER_NAME = 'ensemblr';

/**
 * Builds the `mcpServers` map pointing Claude Code at the loopback control
 * server Ensemblr already runs. Unlike Pi — which reaches the same server
 * through a bundled extension because it has no native MCP client — Claude
 * connects to it directly.
 *
 * The Authorization header carries a reference to the token env var rather than
 * the token: the Agent SDK serialises this map verbatim into a `--mcp-config`
 * argument, so a literal token would be readable via `ps` by any process on the
 * machine. Claude expands the reference itself, exactly as the terminal-harness
 * launch decoration already relies on.
 * @param control - Resolved control-server URL and this session's bearer token.
 * @returns The `mcpServers` option, or an empty map when control is unavailable.
 */
export function buildClaudeMcpServers(
	control: AgentControlMcpConfig | null | undefined,
): Record<string, McpServerConfig> {
	if (!control?.url || !control.token) {
		return {};
	}

	return {
		[CONTROL_SERVER_NAME]: {
			headers: {
				Authorization: `Bearer ${envVarReference(CONTROL_TOKEN_ENV_KEY)}`,
			},
			type: 'http',
			url: new URL('/mcp', control.url).toString(),
		},
	};
}
