/**
 * Everything Ensemblr adds to a third-party harness's launch command: the
 * MCP config that points it at the control server's `/mcp` endpoint, and the
 * instructions file that tells it what that server is for.
 *
 * The control-server URL is one constant per app session; the per-workspace
 * token is never written into the command. Each harness reads it from the
 * injected `ENSEMBLR_CONTROL_TOKEN` env var — Claude via `${VAR}` header
 * expansion in `--mcp-config`, Codex via `bearer_token_env_var`, Vibe via
 * `api_key_env` — so the secret cannot leak through process argv (`ps`).
 *
 * Vibe accepts no MCP-config flag: it has no `--mcp-config`, its `-c` is
 * `--continue` rather than a config override, and `/mcp add` is an in-session
 * OAuth-only command. Its only per-launch channel is `VIBE_*` env vars, so its
 * server is a `VIBE_MCP_SERVERS` JSON assignment prefixed to the command —
 * which still carries the token variable's *name*, not its value.
 *
 * The instructions reach each harness differently, and Codex not at all. Claude
 * appends the file to its system prompt (`--append-system-prompt-file`); Vibe
 * discovers it as project instructions from an extra trusted root (`--add-dir`,
 * which is why the file is named `AGENTS.md`); Codex has no additive lever —
 * `model_instructions_file` replaces its built-in prompt outright and its only
 * other channel is an `AGENTS.md` inside the user's own repository — so it
 * relies on the MCP server's `instructions` field, which it surfaces to the
 * model as the tool namespace's description.
 *
 * Flags are added to the registry-built command in the main process, so the
 * renderer never supplies them.
 */

import path from 'node:path';

import { CONTROL_TOKEN_ENV_KEY, envVarReference } from './control-env-keys.ts';

/** Env var carrying the per-workspace control token in a harness process. */
const TOKEN_ENV_VAR = CONTROL_TOKEN_ENV_KEY;

/**
 * Filename the harness playbook is written under. Vibe discovers instructions
 * only from a file with this exact name, so the other harnesses point at it too
 * rather than keeping a second copy under a nicer name.
 */
export const HARNESS_INSTRUCTIONS_FILENAME = 'AGENTS.md';

/** What a harness needs added to its launch line, split by where it goes. */
export interface HarnessLaunchDecoration {
	/** `VAR=value` assignments prefixed before the command. */
	env: readonly string[];
	/** Flags appended after the registry-built command. */
	flags: readonly string[];
}

/** The empty decoration, for a harness or app state with nothing to add. */
const NOTHING: HarnessLaunchDecoration = { env: [], flags: [] };

/**
 * Quotes a value for `sh -c`, escaping any embedded single quote.
 * @param value - Raw value to quote.
 * @returns The value wrapped in single quotes, safe to splice into a command.
 */
function quote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Resolves the instructions file inside its directory, or null when the app has
 * no directory to offer (the playbook failed to write).
 * @param directory - Directory holding the harness playbook, or null.
 * @returns Absolute path to the playbook file, or null.
 */
function instructionsFile(directory: string | null): string | null {
	return directory ? path.join(directory, HARNESS_INSTRUCTIONS_FILENAME) : null;
}

/**
 * Builds Claude Code's decoration: an inline `--mcp-config` whose bearer header
 * expands the token env var, plus the playbook appended to its system prompt.
 * Both flags work in an interactive launch alongside `--dangerously-skip-permissions`.
 * @param url - The control server's `/mcp` endpoint.
 * @param directory - Directory holding the harness playbook, or null.
 * @returns Claude's launch decoration.
 */
function claudeDecoration(
	url: string,
	directory: string | null,
): HarnessLaunchDecoration {
	const config = JSON.stringify({
		mcpServers: {
			ensemblr: {
				type: 'http',
				url,
				headers: { Authorization: `Bearer ${envVarReference(TOKEN_ENV_VAR)}` },
			},
		},
	});
	const file = instructionsFile(directory);
	return {
		env: [],
		flags: [
			`--mcp-config ${quote(config)}`,
			...(file ? [`--append-system-prompt-file ${quote(file)}`] : []),
		],
	};
}

/**
 * Builds Codex's decoration: `-c` overrides naming the server URL and the env
 * var holding its bearer token. Codex has no additive instructions flag, so the
 * playbook reaches it only as the MCP server's `instructions` field.
 * @param url - The control server's `/mcp` endpoint.
 * @returns Codex's launch decoration.
 */
function codexDecoration(url: string): HarnessLaunchDecoration {
	return {
		env: [],
		flags: [
			`-c ${quote(`mcp_servers.ensemblr.url="${url}"`)}`,
			`-c ${quote(`mcp_servers.ensemblr.bearer_token_env_var="${TOKEN_ENV_VAR}"`)}`,
		],
	};
}

/**
 * Builds Vibe's decoration: the server as a `VIBE_MCP_SERVERS` env assignment,
 * and the playbook's directory as an extra trusted root whose `AGENTS.md` Vibe
 * loads as project instructions.
 * @param url - The control server's `/mcp` endpoint.
 * @param directory - Directory holding the harness playbook, or null.
 * @returns Vibe's launch decoration.
 */
function vibeDecoration(
	url: string,
	directory: string | null,
): HarnessLaunchDecoration {
	const servers = JSON.stringify([
		{
			name: 'ensemblr',
			transport: 'streamable-http',
			url,
			api_key_env: TOKEN_ENV_VAR,
		},
	]);
	return {
		env: [`VIBE_MCP_SERVERS=${quote(servers)}`],
		flags: directory ? [`--add-dir ${quote(directory)}`] : [],
	};
}

/**
 * Builds what a harness needs added to its launch line, or nothing when the
 * harness has no known configuration mechanism.
 * @param harnessId - Harness registry id (`claude`, `codex`, `vibe`, …).
 * @param baseUrl - Control server base URL (e.g. `http://127.0.0.1:53219`).
 * @param instructionsDirectory - Directory holding the harness playbook, or null.
 * @returns The env assignments and flags to add.
 */
export function buildHarnessLaunchDecoration(
	harnessId: string,
	baseUrl: string,
	instructionsDirectory: string | null = null,
): HarnessLaunchDecoration {
	const url = `${baseUrl}/mcp`;
	switch (harnessId) {
		case 'claude':
			return claudeDecoration(url, instructionsDirectory);
		case 'codex':
			return codexDecoration(url);
		case 'vibe':
			return vibeDecoration(url, instructionsDirectory);
		default:
			return NOTHING;
	}
}

/** Everything {@link decorateHarnessCommand} needs beyond the command itself. */
export interface HarnessLaunchContext {
	/** Control server base URL, or null when the server is down. */
	baseUrl: string | null;
	/** Harness registry id. */
	harnessId: string;
	/** Directory holding the harness playbook, or null when it is unavailable. */
	instructionsDirectory: string | null;
	/**
	 * Per-workspace control token, or null when unavailable. Used only as an
	 * availability gate — it is never embedded in the command.
	 */
	token: string | null;
}

/**
 * Decorates a harness launch command with its Ensemblr MCP config and
 * instructions, leaving it untouched when the control server is unreachable —
 * a playbook describing tools the harness cannot reach is worse than silence.
 * @param command - Registry-built launch command string.
 * @param context - Server URL, token, harness id, and playbook directory.
 * @returns The command, decorated when applicable.
 */
export function decorateHarnessCommand(
	command: string,
	context: HarnessLaunchContext,
): string {
	if (!context.baseUrl || !context.token) {
		return command;
	}
	const { env, flags } = buildHarnessLaunchDecoration(
		context.harnessId,
		context.baseUrl,
		context.instructionsDirectory,
	);
	const prefix = env.length > 0 ? `${env.join(' ')} ` : '';
	const suffix = flags.length > 0 ? ` ${flags.join(' ')}` : '';
	return `${prefix}${command}${suffix}`;
}
