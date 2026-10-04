import type { McpServerStatus, Query } from '@anthropic-ai/claude-agent-sdk';

import { CONTROL_SERVER_NAME } from '../../shared/agent-control.ts';

/**
 * The variable Claude Code reads to learn how long a host wants a streaming
 * session's first turn to wait for MCP servers to connect. The CLI reads it, not
 * the SDK, so it travels in the child's environment.
 */
const MCP_STARTUP_WAIT_ENV_KEY = 'CLAUDE_CODE_MCP_STARTUP_WAIT_MS';

/**
 * How long the first prompt waits for the control server before going without
 * it. Matches the cap Claude Code puts on a server whose tools must be present
 * at the first turn, so a wedged loopback server costs what a wedged
 * `alwaysLoad` server would rather than the 30 s connect timeout.
 */
const CONTROL_SERVER_WAIT_MS = 5000;

/** Gap between status reads while the control server is still connecting. */
const CONTROL_SERVER_POLL_MS = 50;

/** One MCP server's connection state as the runtime reports it. */
type McpConnectionStatus = McpServerStatus['status'];

/** A session that can report its MCP servers' connection state. */
type McpStatusReader = Pick<Query, 'mcpServerStatus'>;

/**
 * Stops Claude Code holding a session's first turn until every configured MCP
 * server has connected.
 *
 * Passing `mcpServers` makes the SDK launch the CLI with `--mcp-config`, and a
 * streaming session launched that way waits for every server it knows — the
 * user's plugins and claude.ai connectors included, failing ones too — for up to
 * `MCP_TIMEOUT`, 30 s by default, before it reads the first prompt. The
 * interactive CLI and the IDE extensions pass no such flag and wait for none, so
 * a chat that should answer in two seconds answered in thirty. A value already
 * in the environment is the user's own choice and is kept.
 * @param env - The session environment, already merged and stripped.
 * @returns The environment with the first-turn MCP wait switched off.
 */
export function withoutMcpStartupWait(
	env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
	if (env[MCP_STARTUP_WAIT_ENV_KEY] !== undefined) {
		return env;
	}
	return { ...env, [MCP_STARTUP_WAIT_ENV_KEY]: '0' };
}

/**
 * Waits until the Ensemblr control server has finished connecting, so the first
 * turn reaches the model carrying the `ensemblr_*` tools its prompt asks for.
 *
 * This is the single wait {@link withoutMcpStartupWait} gives back, narrowed to
 * the one server Ensemblr depends on. It settles on any status but `pending` — a
 * failed or unconfigured server will not connect by waiting — and on the
 * deadline, on the session closing, and on a read the runtime cannot answer, so
 * it can delay a first prompt but never strand one.
 * @param session - The live query to read connection state from.
 * @param options - `isClosed` reports the session ending; `sleep` and `timeoutMs` are test seams.
 * @returns The control server's last status, `pending` when the deadline passed
 *   first, or null when the runtime reported none.
 */
export async function waitForControlServer(
	session: McpStatusReader,
	{
		isClosed,
		sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		timeoutMs = CONTROL_SERVER_WAIT_MS,
	}: {
		isClosed: () => boolean;
		sleep?: (ms: number) => Promise<void>;
		timeoutMs?: number;
	},
): Promise<McpConnectionStatus | null> {
	const deadline = Date.now() + timeoutMs;
	let status: McpConnectionStatus | null = null;
	while (!isClosed() && Date.now() < deadline) {
		status = await readControlServerStatus(session, deadline - Date.now());
		if (status !== 'pending') {
			return status;
		}
		await sleep(CONTROL_SERVER_POLL_MS);
	}
	return status;
}

/**
 * Reads the control server's connection state, giving up on a runtime that has
 * not answered within the budget.
 * @param session - The live query to read connection state from.
 * @param budgetMs - How long the read may take.
 * @returns The status; `pending` when the read outlived its budget; null when the
 *   server is not configured or the runtime refused the read.
 */
async function readControlServerStatus(
	session: McpStatusReader,
	budgetMs: number,
): Promise<McpConnectionStatus | null> {
	let timer: NodeJS.Timeout | undefined;
	const expiry = new Promise<McpConnectionStatus>((resolve) => {
		timer = setTimeout(() => resolve('pending'), budgetMs);
	});
	try {
		const read = session
			.mcpServerStatus()
			.then(
				(servers) =>
					servers.find((server) => server.name === CONTROL_SERVER_NAME)
						?.status ?? null,
			);
		return await Promise.race([read, expiry]);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
