import { performance } from 'node:perf_hooks';

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

/**
 * Builds a service that runs local commands with sanitized logs and a
 * lazily-resolved shell environment, protecting Ensemble from PATH/secret leaks.
 * @param options - Optional dependency overrides and tuning knobs.
 * @returns A {@link LocalCommandService} instance.
 */
export function createLocalCommandService(
	options: CreateLocalCommandServiceOptions = {},
): LocalCommandService {
	const baseEnv = normalizeEnvironment(options.baseEnv ?? process.env);
	const commonPathEntries =
		options.commonPathEntries ?? getDefaultCommonPathEntries();
	const environmentTimeoutMs =
		options.environmentTimeoutMs ?? DEFAULT_ENVIRONMENT_TIMEOUT_MS;
	const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
	const now = options.now ?? (() => new Date());
	const shell = options.shell ?? resolveDefaultShell(baseEnv);
	const shellEnvironmentLoader =
		options.shellEnvironmentLoader ?? loadShellEnvironment;
	let environmentPromise: Promise<CommandEnvironmentSnapshot> | null = null;

	/**
	 * Resolves the shell environment on first call and returns a defensive clone
	 * on every subsequent call.
	 * @returns A cloned environment snapshot.
	 */
	async function getEnvironment(): Promise<CommandEnvironmentSnapshot> {
		environmentPromise ??= resolveCommandEnvironment({
			baseEnv,
			commonPathEntries,
			environmentTimeoutMs,
			now,
			shell,
			shellEnvironmentLoader,
		});

		return cloneEnvironmentSnapshot(await environmentPromise);
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
