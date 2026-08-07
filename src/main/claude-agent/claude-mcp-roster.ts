import type { McpServerStatus } from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';

import type {
	AgentProviderMcpServerWire,
	ListAgentProviderMcpServersResult,
} from '../../shared/ipc/contracts/agent-provider';
import { stripLaunchContextEnv } from '../environment/launch-env.ts';
import { createPromptQueue } from './prompt-queue.ts';

/**
 * How long the roster is allowed to keep waiting for servers to finish
 * connecting. A cold start reports most servers as `pending` and they settle
 * over a few seconds; one wedged server must not hold the panel open forever, so
 * whatever is still pending at the deadline is reported as pending.
 */
const DEFAULT_SETTLE_TIMEOUT_MS = 8000;

/** Gap between roster reads while servers are still connecting. */
const POLL_INTERVAL_MS = 750;

/**
 * Permission mode the roster session runs under. It only reads capabilities, so
 * `plan` keeps the child unable to touch the workspace it is pointed at.
 */
const ROSTER_PERMISSION_MODE = 'plan' as const;

/** Options for {@link createClaudeMcpRoster}. */
export interface CreateClaudeMcpRosterOptions {
	/** Resolves the login-shell env, so a Finder-launched app still finds `claude`. */
	resolveBaseEnv?: () => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>;
	/** Resolves the `claude` binary to run; no path means the runtime is unavailable. */
	resolveExecutablePath?: () => string | null | Promise<string | null>;
	/** Injection seam for tests; defaults to the SDK's own `query`. */
	queryFn?: typeof query;
	settleTimeoutMs?: number;
	sleep?: (ms: number) => Promise<void>;
}

/** Projects one SDK MCP server status onto the wire, nulling absent fields. */
function toWire(server: McpServerStatus): AgentProviderMcpServerWire {
	return {
		error: server.error ?? null,
		name: server.name,
		scope: server.scope ?? null,
		status: server.status,
	};
}

/**
 * Reads Claude Code's MCP roster as it resolves inside one workspace.
 *
 * The roster is workspace-scoped on purpose: `project` and `local` servers are
 * declared relative to a directory, so a lookup with no `cwd` silently reports
 * only the user, plugin, and remote-connector tiers. Pointing the session at the
 * workspace is what makes the panel show everything `claude` itself would.
 *
 * Servers connect asynchronously, so a single read catches most of them mid-
 * handshake as `pending`. The roster is re-read until nothing is pending or the
 * settle deadline passes, which is what turns the list from "awaiting status"
 * into the connected/failed/needs-auth split the user acts on.
 * @param options - Env and executable resolution plus test seams.
 * @returns A function returning the roster for one workspace directory.
 */
export function createClaudeMcpRoster({
	queryFn = query,
	resolveBaseEnv = () => process.env,
	resolveExecutablePath = () => null,
	settleTimeoutMs = DEFAULT_SETTLE_TIMEOUT_MS,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: CreateClaudeMcpRosterOptions = {}): (
	cwd: string,
) => Promise<ListAgentProviderMcpServersResult> {
	return async (cwd) => {
		const [baseEnv, executablePath] = await Promise.all([
			resolveBaseEnv(),
			resolveExecutablePath(),
		]);

		if (!executablePath) {
			return {
				error: 'No claude executable was found on your PATH.',
				servers: [],
			};
		}

		const promptQueue = createPromptQueue();
		const session = queryFn({
			options: {
				cwd,
				env: stripLaunchContextEnv({ ...baseEnv }),
				pathToClaudeCodeExecutable: executablePath,
				permissionMode: ROSTER_PERMISSION_MODE,
			},
			prompt: promptQueue.stream,
		});

		try {
			return { error: null, servers: await pollUntilSettled() };
		} catch (error) {
			return {
				error:
					error instanceof Error
						? error.message
						: 'Claude Code did not report its MCP servers.',
				servers: [],
			};
		} finally {
			promptQueue.close();
			session.close();
		}

		/** Re-reads the roster until nothing is connecting or time runs out. */
		async function pollUntilSettled(): Promise<
			readonly AgentProviderMcpServerWire[]
		> {
			const deadline = Date.now() + settleTimeoutMs;
			let servers = (await session.mcpServerStatus()).map(toWire);

			while (
				servers.some((server) => server.status === 'pending') &&
				Date.now() < deadline
			) {
				await sleep(POLL_INTERVAL_MS);
				servers = (await session.mcpServerStatus()).map(toWire);
			}

			return servers;
		}
	};
}
