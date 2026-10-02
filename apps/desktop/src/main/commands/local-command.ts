import { performance } from 'node:perf_hooks';

import { stripLaunchContextEnv } from '../environment/launch-env.ts';
import {
	cloneEnvironmentSnapshot,
	getDefaultCommonPathEntries,
	loadShellEnvironment,
	mergeEnvironment,
	normalizeEnvironment,
	resolveCommandEnvironment,
	resolveDefaultShell,
} from './command-environment.ts';
import { createSanitizedLogs } from './command-redaction.ts';
import {
	normalizeLocalCommandRequest,
	validateCwd,
} from './command-request.ts';
import { createFailure, createLocalCommandResult } from './command-result.ts';
import type {
	CommandEnvironmentSnapshot,
	CreateLocalCommandServiceOptions,
	LocalCommandFailure,
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandRunOptions,
	LocalCommandService,
} from './command-types.ts';
import { runSpawnedCommand } from './spawn-command.ts';

export type {
	CommandDiagnosticSeverity,
	CommandEnvironmentDiagnostic,
	CommandEnvironmentSnapshot,
	CommandEnvironmentSource,
	CreateLocalCommandServiceOptions,
	LocalCommandFailure,
	LocalCommandFailureCode,
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandRunOptions,
	LocalCommandSanitizedLogs,
	LocalCommandService,
	LocalCommandStatus,
	ShellEnvironmentLoader,
	ShellEnvironmentLoaderRequest,
	ShellEnvironmentLoaderResult,
} from './command-types.ts';

const DEFAULT_ENVIRONMENT_TIMEOUT_MS = 3000;
const DEFAULT_KILL_GRACE_MS = 500;
const DEFAULT_FALLBACK_RETRY_COOLDOWN_MS = 30_000;

/**
 * Builds a service that runs local commands with sanitized logs and a
 * lazily-resolved shell environment, protecting Ensemblr from PATH/secret leaks.
 * @param options - Optional dependency overrides and tuning knobs.
 * @returns A {@link LocalCommandService} instance.
 */
export function createLocalCommandService(
	options: CreateLocalCommandServiceOptions = {},
): LocalCommandService {
	// Strip macOS/Electron launch-context vars before they seed the shell
	// environment captured for pi, local commands, and readiness — otherwise a
	// spawned process running `open`/LaunchServices makes macOS relaunch Ensemblr.
	const baseEnv = normalizeEnvironment(
		stripLaunchContextEnv(options.baseEnv ?? process.env),
	);
	const commonPathEntries =
		options.commonPathEntries ?? getDefaultCommonPathEntries();
	const environmentTimeoutMs =
		options.environmentTimeoutMs ?? DEFAULT_ENVIRONMENT_TIMEOUT_MS;
	const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
	const fallbackRetryCooldownMs =
		options.fallbackRetryCooldownMs ?? DEFAULT_FALLBACK_RETRY_COOLDOWN_MS;
	const now = options.now ?? (() => new Date());
	const shell = options.shell ?? resolveDefaultShell(baseEnv);
	const shellEnvironmentLoader =
		options.shellEnvironmentLoader ?? loadShellEnvironment;
	// Keyed by resolution cwd ('' for the process-default env) so directory-aware
	// version managers can be resolved per workspace without re-spawning a shell
	// on every lookup. A successful ('shell') snapshot is memoized for the whole
	// session; a fallback snapshot is memoized only until its cooldown lapses so a
	// transient timeout can recover, yet a persistently slow shell stops storming
	// interactive-shell spawns (each of which risks a stray macOS relaunch).
	const environmentPromises = new Map<
		string,
		Promise<CommandEnvironmentSnapshot>
	>();
	// Epoch-ms after which a cached fallback for a key may be retried.
	const fallbackRetryAt = new Map<string, number>();

	/**
	 * Resolves the shell environment for a directory on first call and returns a
	 * defensive clone on every subsequent call for the same directory. A fallback
	 * resolution is cached only until its cooldown lapses, so a later call retries
	 * the shell without re-spawning one on every lookup in the meantime.
	 * @param cwd - Directory to resolve the login-shell environment in; omitted
	 * resolves the Electron process's default environment.
	 * @returns A cloned environment snapshot.
	 */
	async function getEnvironment(
		cwd?: string,
	): Promise<CommandEnvironmentSnapshot> {
		const key = cwd ?? '';
		const cached = environmentPromises.get(key);

		if (cached) {
			const cachedSnapshot = await cached;
			const retryAt = fallbackRetryAt.get(key);
			const cooldownLapsed =
				retryAt !== undefined && now().getTime() >= retryAt;

			if (cachedSnapshot.source === 'shell' || !cooldownLapsed) {
				return cloneEnvironmentSnapshot(cachedSnapshot);
			}

			environmentPromises.delete(key);
			fallbackRetryAt.delete(key);
		}

		const environmentPromise = resolveCommandEnvironment({
			baseEnv,
			commonPathEntries,
			cwd,
			environmentTimeoutMs,
			now,
			shell,
			shellEnvironmentLoader,
		});
		environmentPromises.set(key, environmentPromise);

		const snapshot = await environmentPromise;

		if (snapshot.source === 'shell') {
			fallbackRetryAt.delete(key);
		} else {
			fallbackRetryAt.set(key, now().getTime() + fallbackRetryCooldownMs);
		}

		return cloneEnvironmentSnapshot(snapshot);
	}

	/**
	 * Validates the request, prepares the spawn environment and runs the command,
	 * returning a sanitized result regardless of whether the process exited cleanly.
	 * @param request - Command, args, cwd, env overrides and limits.
	 * @param runOptions - Optional abort signal.
	 * @returns A {@link LocalCommandResult} describing the outcome.
	 */
	async function run(
		request: LocalCommandRequest,
		runOptions: LocalCommandRunOptions = {},
	): Promise<LocalCommandResult> {
		const input = normalizeLocalCommandRequest(request);

		const buildPreSpawnFailure = (
			failure: LocalCommandFailure,
		): LocalCommandResult =>
			createLocalCommandResult({
				args: input.args,
				command: input.command,
				cwd: input.cwd ?? process.cwd(),
				environment: null,
				exitCode: null,
				failure,
				logs: createSanitizedLogs({
					args: input.args,
					command: input.command,
					cwd: input.cwd ?? process.cwd(),
					env: {},
					stderr: '',
					stdout: '',
				}),
				signal: null,
				startedAt: now().toISOString(),
				startedMs: performance.now(),
				status: 'failure',
				stderr: '',
				stderrTruncated: false,
				stdout: '',
				stdoutTruncated: false,
			});

		if (input.failure) {
			return buildPreSpawnFailure(input.failure);
		}

		const cwd = validateCwd(input.cwd ?? process.cwd());

		if (cwd.failure) {
			return buildPreSpawnFailure(cwd.failure);
		}

		const environment = await getEnvironment();
		const env = mergeEnvironment(environment.env, input.env);
		const startedAt = now().toISOString();
		const startedMs = performance.now();

		if (runOptions.signal?.aborted) {
			const failure = createFailure(
				'canceled',
				'The command was canceled before it started.',
				null,
				null,
			);

			return createLocalCommandResult({
				args: input.args,
				command: input.command,
				cwd: cwd.path,
				environment,
				exitCode: null,
				failure,
				logs: createSanitizedLogs({
					args: input.args,
					command: input.command,
					cwd: cwd.path,
					env,
					stderr: '',
					stdout: '',
				}),
				signal: null,
				startedAt,
				startedMs,
				status: 'failure',
				stderr: '',
				stderrTruncated: false,
				stdout: '',
				stdoutTruncated: false,
			});
		}

		return runSpawnedCommand({
			args: input.args,
			command: input.command,
			cwd: cwd.path,
			environment,
			env,
			killGraceMs,
			maxOutputBytes: input.maxOutputBytes,
			redactValues: input.redactValues,
			signal: runOptions.signal,
			startedAt,
			startedMs,
			timeoutMs: input.timeoutMs,
		});
	}

	return {
		getEnvironment,
		run,
	};
}
