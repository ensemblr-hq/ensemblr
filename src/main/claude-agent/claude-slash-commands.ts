import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';

import type {
	AgentProviderSlashCommandWire,
	ListAgentProviderSlashCommandsResult,
} from '../../shared/ipc/contracts/agent-provider';
import { stripLaunchContextEnv } from '../environment/launch-env.ts';
import { createPromptQueue } from './prompt-queue.ts';

/**
 * Permission mode the discovery session runs under. It only reads capabilities,
 * so `plan` keeps the child unable to touch the workspace it is pointed at.
 */
const DISCOVERY_PERMISSION_MODE = 'plan' as const;

/** Options for {@link createClaudeSlashCommands}. */
export interface CreateClaudeSlashCommandsOptions {
	/** Injection seam for tests; defaults to the SDK's own `query`. */
	queryFn?: typeof query;
	/** Resolves the login-shell env, so a Finder-launched app still finds `claude`. */
	resolveBaseEnv?: () => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>;
	/** Resolves the `claude` binary to run; no path means the runtime is unavailable. */
	resolveExecutablePath?: () => string | null | Promise<string | null>;
}

/**
 * Projects one SDK command onto the wire. Claude Code reports no provenance for
 * a command — a built-in, a project command, and a plugin skill arrive in one
 * undifferentiated list — so `source` is left unset rather than guessed, and
 * `autoSubmit` stays false so picking a command never sends a turn the user did
 * not ask for.
 * @param command - One command as the SDK reported it.
 * @returns The IPC-safe command.
 */
function toWire(command: SlashCommand): AgentProviderSlashCommandWire {
	return {
		autoSubmit: false,
		command: command.name,
		description: command.description,
	};
}

/**
 * Reads Claude Code's slash commands as they resolve inside one workspace.
 *
 * The catalogue is workspace-scoped on purpose: `.claude/commands`, project
 * skills, and project-installed plugins are all declared relative to a
 * directory, so a lookup with no `cwd` reports only the user-level tier. The
 * discovery session is short-lived — it exists to answer `supportedCommands()`
 * and is closed immediately after.
 * @param options - Env and executable resolution plus test seams.
 * @returns A function returning the commands for one workspace directory.
 */
export function createClaudeSlashCommands({
	queryFn = query,
	resolveBaseEnv = () => process.env,
	resolveExecutablePath = () => null,
}: CreateClaudeSlashCommandsOptions = {}): (
	cwd: string,
) => Promise<ListAgentProviderSlashCommandsResult> {
	return async (cwd) => {
		const [baseEnv, executablePath] = await Promise.all([
			resolveBaseEnv(),
			resolveExecutablePath(),
		]);

		if (!executablePath) {
			return {
				commands: [],
				error: 'No claude executable was found on your PATH.',
				source: 'runtime',
			};
		}

		const promptQueue = createPromptQueue();
		const session = queryFn({
			options: {
				cwd,
				env: stripLaunchContextEnv({ ...baseEnv }),
				pathToClaudeCodeExecutable: executablePath,
				permissionMode: DISCOVERY_PERMISSION_MODE,
			},
			prompt: promptQueue.stream,
		});

		try {
			return {
				commands: (await session.supportedCommands()).map(toWire),
				error: null,
				source: 'runtime',
			};
		} catch (error) {
			return {
				commands: [],
				error:
					error instanceof Error
						? error.message
						: 'Claude Code did not report its slash commands.',
				source: 'runtime',
			};
		} finally {
			promptQueue.close();
			session.close();
		}
	};
}
