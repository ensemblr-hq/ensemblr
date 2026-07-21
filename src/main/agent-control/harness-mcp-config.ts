/**
 * Per-harness MCP-config flags that point a launched third-party harness at the
 * Ensemblr control server's `/mcp` endpoint. The control-server URL is one
 * constant per app session; the per-workspace token is never written into the
 * launch command — both harnesses read it from the injected
 * `ENSEMBLR_CONTROL_TOKEN` env var (Claude via `${VAR}` header expansion in
 * `--mcp-config`, Codex via `bearer_token_env_var`) so the secret cannot leak
 * through process argv (`ps`/`/proc`). Flags are appended to the registry-built
 * launch command in the main process, so the renderer never supplies them.
 */

/** Env var carrying the per-workspace control token in a harness process. */
const TOKEN_ENV_VAR = 'ENSEMBLR_CONTROL_TOKEN';

/**
 * Builds the harness-specific CLI flags that register the Ensemblr MCP server.
 * @param harnessId - Harness registry id (`claude`, `codex`, `vibe`, …).
 * @param baseUrl - Control server base URL (e.g. `http://127.0.0.1:53219`).
 * @returns A flag string to append to the launch command, or `''` when the
 *   harness has no known HTTP-MCP config mechanism.
 */
export function buildHarnessMcpArgs(
	harnessId: string,
	baseUrl: string,
): string {
	const url = `${baseUrl}/mcp`;
	if (harnessId === 'claude') {
		const config = JSON.stringify({
			mcpServers: {
				ensemblr: {
					type: 'http',
					url,
					headers: { Authorization: `Bearer \${${TOKEN_ENV_VAR}}` },
				},
			},
		});
		return `--mcp-config '${config}'`;
	}
	if (harnessId === 'codex') {
		return `-c 'mcp_servers.ensemblr.url="${url}"' -c 'mcp_servers.ensemblr.bearer_token_env_var="${TOKEN_ENV_VAR}"'`;
	}
	return '';
}

/**
 * Appends the Ensemblr MCP-config flags to a harness launch command.
 * @param command - Registry-built launch command string.
 * @param harnessId - Harness registry id.
 * @param baseUrl - Control server base URL, or null when the server is down.
 * @param token - Per-workspace control token, or null when unavailable; used
 *   only as an availability gate — it is never embedded in the command.
 * @returns The command, augmented with MCP flags when applicable.
 */
export function appendHarnessMcpConfig(
	command: string,
	harnessId: string,
	baseUrl: string | null,
	token: string | null,
): string {
	if (!baseUrl || !token) {
		return command;
	}
	const args = buildHarnessMcpArgs(harnessId, baseUrl);
	return args ? `${command} ${args}` : command;
}
