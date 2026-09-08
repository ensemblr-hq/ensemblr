import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
	AgentProviderSlashCommandWire,
	ListAgentProviderSlashCommandsResult,
} from '../../shared/ipc/contracts/agent-provider';
import type { PiExecutableSnapshot } from '../pi-runtime';
import { isExecutableReady } from '../pi-runtime/pi-executable.ts';
import { isRecord, queryPiCommands } from './cli-rpc/command-query.ts';
import {
	buildSpawnEnv,
	defaultSpawn,
	type ResolveBaseEnv,
	type SpawnFn,
} from './cli-rpc/spawn-env.ts';

/** Active queries only; completed results remain the renderer cache's responsibility. */
const inFlight = new WeakMap<
	SpawnFn,
	Map<string, Promise<ListAgentProviderSlashCommandsResult>>
>();

/**
 * Resolves prompt-invokable commands through the configured executable's public
 * get_commands RPC. Pi owns settings, trust, packages, and resource precedence;
 * Ensemblr adds only its shipped skills and never approves a project or dialog.
 * Failures retain static provenance so the renderer retries rather than caching
 * them as a valid empty catalogue.
 * @param executable - Resolved Pi executable, including arbitrary wrappers.
 * @param cwd - Workspace whose project resources Pi should discover.
 * @param shippedSkillPaths - Additional skill directories passed to live sessions.
 * @param options - Login-shell environment and injectable transport/deadlines.
 * @returns Commands with runtime provenance, or a retryable discovery failure.
 */
export async function resolvePiSlashCommands(
	executable: PiExecutableSnapshot,
	cwd?: string,
	shippedSkillPaths: readonly string[] = [],
	options: {
		resolveBaseEnv?: ResolveBaseEnv;
		spawn?: SpawnFn;
		timeoutMs?: number;
		killGraceMs?: number;
	} = {},
): Promise<ListAgentProviderSlashCommandsResult> {
	if (!isExecutableReady(executable)) {
		return discoveryFailure(new Error('Pi executable is not ready.'));
	}
	try {
		const env = buildSpawnEnv(
			await (options.resolveBaseEnv?.() ?? process.env),
			{},
		);
		const workspaceCwd = path.resolve(cwd?.trim() || process.cwd());
		const spawn = options.spawn ?? defaultSpawn;
		const timeoutMs = options.timeoutMs ?? 10_000;
		const killGraceMs = options.killGraceMs ?? 750;
		const args = [
			'--mode',
			'rpc',
			'--no-session',
			'--no-tools',
			...shippedSkillPaths.flatMap((directory) => ['--skill', directory]),
		];
		const key = createHash('sha256')
			.update(
				JSON.stringify([
					executable.command,
					workspaceCwd,
					args,
					timeoutMs,
					killGraceMs,
					Object.entries(env).sort(([left], [right]) =>
						left.localeCompare(right),
					),
				]),
			)
			.digest('hex');
		let queries = inFlight.get(spawn);
		if (!queries) {
			queries = new Map();
			inFlight.set(spawn, queries);
		}
		const existing = queries.get(key);
		if (existing) return await existing;
		const pending = queryPiCommands({
			args,
			command: executable.command,
			cwd: workspaceCwd,
			env,
			killGraceMs,
			spawn,
			timeoutMs,
		})
			.then(
				(data): ListAgentProviderSlashCommandsResult => ({
					commands: normalizeCommands(data),
					error: null,
					source: 'runtime',
				}),
			)
			.catch(discoveryFailure);
		queries.set(key, pending);
		try {
			return await pending;
		} finally {
			queries.delete(key);
		}
	} catch (cause) {
		return discoveryFailure(cause);
	}
}

/**
 * Validates the entire documented payload; a partially malformed catalogue is
 * a failure, never a filtered empty success. Explicit-path resources map onto
 * the existing temporary scope without changing the renderer IPC contract.
 * Newer Pi releases send sourceInfo.scope instead of the documented location.
 * @param data - Untrusted get_commands response data.
 * @returns Commands in Pi's order with their source and optional location.
 */
function normalizeCommands(data: unknown): AgentProviderSlashCommandWire[] {
	if (!isRecord(data) || !Array.isArray(data.commands)) {
		throw new Error('Pi RPC get_commands returned malformed command data.');
	}
	return data.commands.map((entry: unknown) => {
		if (
			!isRecord(entry) ||
			typeof entry.name !== 'string' ||
			!entry.name.trim() ||
			(entry.description !== undefined &&
				typeof entry.description !== 'string') ||
			(entry.source !== 'extension' &&
				entry.source !== 'prompt' &&
				entry.source !== 'skill') ||
			(entry.location !== undefined &&
				entry.location !== 'user' &&
				entry.location !== 'project' &&
				entry.location !== 'path') ||
			(entry.path !== undefined && typeof entry.path !== 'string')
		) {
			throw new Error('Pi RPC get_commands returned a malformed command.');
		}
		const sourceInfo = entry.sourceInfo;
		if (sourceInfo !== undefined && !isRecord(sourceInfo)) {
			throw new Error(
				'Pi RPC get_commands returned malformed source information.',
			);
		}
		const scope = sourceInfo?.scope;
		if (
			scope !== undefined &&
			scope !== 'user' &&
			scope !== 'project' &&
			scope !== 'temporary'
		) {
			throw new Error('Pi RPC get_commands returned a malformed source scope.');
		}
		return {
			autoSubmit: false,
			command: entry.name,
			description: entry.description ?? '',
			source: entry.source,
			sourceScope:
				scope ?? (entry.location === 'path' ? 'temporary' : entry.location),
		};
	});
}

/**
 * Preserves the provider contract's failure-versus-valid-empty distinction.
 * @param cause - Transport, environment, or payload validation failure.
 * @returns Empty fallback result, which the renderer never persists as runtime success.
 */
function discoveryFailure(
	cause: unknown,
): ListAgentProviderSlashCommandsResult {
	return {
		commands: [],
		error:
			cause instanceof Error
				? cause.message
				: 'Pi RPC command discovery failed.',
		source: 'static',
	};
}
