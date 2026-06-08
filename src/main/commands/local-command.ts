import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export type CommandEnvironmentSource = 'fallback' | 'shell';
export type CommandDiagnosticSeverity = 'info' | 'warning';
export type LocalCommandStatus = 'failure' | 'success';

export type LocalCommandFailureCode =
	| 'canceled'
	| 'command-not-found'
	| 'invalid-cwd'
	| 'invalid-input'
	| 'nonzero-exit'
	| 'output-truncated'
	| 'spawn-error'
	| 'timeout';

/** Single advisory diagnostic emitted while resolving the command environment. */
export interface CommandEnvironmentDiagnostic {
	code: string;
	message: string;
	severity: CommandDiagnosticSeverity;
}

/** Resolved environment used to launch local commands. */
export interface CommandEnvironmentSnapshot {
	diagnostics: CommandEnvironmentDiagnostic[];
	env: Record<string, string>;
	path: string;
	resolvedAt: string;
	shell: string;
	source: CommandEnvironmentSource;
}

/** Caller-provided description of a local command to run. */
export interface LocalCommandRequest {
	args?: readonly string[];
	command: string;
	cwd?: string;
	env?: Record<string, string | null | undefined>;
	maxOutputBytes?: number;
	redactValues?: readonly string[];
	timeoutMs?: number;
}

/** Failure metadata attached to a non-success {@link LocalCommandResult}. */
export interface LocalCommandFailure {
	code: LocalCommandFailureCode;
	exitCode: number | null;
	message: string;
	signal: NodeJS.Signals | string | null;
}

/** Sanitized log payload safe for persistence and surface to the renderer. */
export interface LocalCommandSanitizedLogs {
	command: string;
	cwd: string;
	env: Record<string, string>;
	stderr: string;
	stdout: string;
}

/** Result of a {@link LocalCommandService.run} call. */
export interface LocalCommandResult {
	args: string[];
	command: string;
	cwd: string;
	durationMs: number;
	endedAt: string;
	environment: CommandEnvironmentSnapshot | null;
	exitCode: number | null;
	failure?: LocalCommandFailure;
	logs: LocalCommandSanitizedLogs;
	signal: NodeJS.Signals | string | null;
	startedAt: string;
	status: LocalCommandStatus;
	stderr: string;
	stderrTruncated: boolean;
	stdout: string;
	stdoutTruncated: boolean;
}

/** Per-call options for {@link LocalCommandService.run}. */
export interface LocalCommandRunOptions {
	signal?: AbortSignal;
}

/** Public surface of the local command service. */
export interface LocalCommandService {
	getEnvironment: () => Promise<CommandEnvironmentSnapshot>;
	run: (
		request: LocalCommandRequest,
		options?: LocalCommandRunOptions,
	) => Promise<LocalCommandResult>;
}

/** Input passed to a {@link ShellEnvironmentLoader}. */
export interface ShellEnvironmentLoaderRequest {
	baseEnv: Record<string, string>;
	shell: string;
	timeoutMs: number;
}

/** Result of a single shell-environment loader invocation. */
export interface ShellEnvironmentLoaderResult {
	error?: Error;
	exitCode: number | null;
	signal: NodeJS.Signals | string | null;
	stderr: string;
	stdout: string;
	timedOut?: boolean;
}

/** Pluggable hook that runs a login shell and captures its environment. */
export type ShellEnvironmentLoader = (
	request: ShellEnvironmentLoaderRequest,
) => Promise<ShellEnvironmentLoaderResult>;

/** Options for {@link createLocalCommandService}. */
export interface CreateLocalCommandServiceOptions {
	baseEnv?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	commonPathEntries?: readonly string[];
	environmentTimeoutMs?: number;
	killGraceMs?: number;
	now?: () => Date;
	shell?: string;
	shellEnvironmentLoader?: ShellEnvironmentLoader;
}

type TerminationReason = 'canceled' | 'output-truncated' | 'timeout';

const DEFAULT_ENVIRONMENT_TIMEOUT_MS = 3000;
const DEFAULT_KILL_GRACE_MS = 500;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const REDACTED = '[REDACTED]';
const SHELL_ENVIRONMENT_BEGIN_SENTINEL = '__ENSEMBLE_SHELL_ENV_BEGIN__';
const SHELL_ENVIRONMENT_END_SENTINEL = '__ENSEMBLE_SHELL_ENV_END__';
const SENSITIVE_KEY_PARTS = [
	'accesstoken',
	'apikey',
	'auth',
	'credential',
	'password',
	'privatekey',
	'secret',
	'token',
];
const SENSITIVE_ASSIGNMENT_PATTERN =
	/\b([A-Z0-9_.-]*(?:ACCESS[_-]?TOKEN|API[_-]?KEY|CREDENTIAL|PASSWORD|PRIVATE[_-]?KEY|SECRET|TOKEN)[A-Z0-9_.-]*)(\s*[=:]\s*)(["']?)([^\s"',;]+)/gi;

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

/**
 * Validates and defaults a {@link LocalCommandRequest}, surfacing the first
 * shape problem as an `invalid-input` failure instead of throwing.
 * @param request - Raw caller-provided request.
 * @returns Normalised fields plus an optional failure when input is invalid.
 */
function normalizeLocalCommandRequest(request: LocalCommandRequest): {
	args: string[];
	command: string;
	cwd?: string;
	env: Record<string, string | null | undefined>;
	failure?: LocalCommandFailure;
	maxOutputBytes: number;
	redactValues: readonly string[];
	timeoutMs?: number;
} {
	const command =
		typeof request.command === 'string' ? request.command.trim() : '';
	const args = Array.isArray(request.args) ? Array.from(request.args) : [];
	const env = request.env ?? {};
	const redactValues = request.redactValues ?? [];
	const maxOutputBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

	if (!command) {
		return {
			args,
			command,
			env,
			failure: createFailure(
				'invalid-input',
				'Command must be a non-empty string.',
				null,
				null,
			),
			maxOutputBytes,
			redactValues,
		};
	}

	if (command.includes('\u0000')) {
		return {
			args,
			command,
			env,
			failure: createFailure(
				'invalid-input',
				'Command must not contain NUL bytes.',
				null,
				null,
			),
			maxOutputBytes,
			redactValues,
		};
	}

	const invalidArg = args.find(
		(arg) => typeof arg !== 'string' || arg.includes('\u0000'),
	);

	if (invalidArg !== undefined) {
		return {
			args,
			command,
			env,
			failure: createFailure(
				'invalid-input',
				'Command arguments must be strings without NUL bytes.',
				null,
				null,
			),
			maxOutputBytes,
			redactValues,
		};
	}

	const invalidEnvKey = Object.keys(env).find(
		(key) => !key || key.includes('=') || key.includes('\u0000'),
	);
	const invalidEnvValue = Object.values(env).find(
		(value) => typeof value === 'string' && value.includes('\u0000'),
	);

	if (invalidEnvKey !== undefined || invalidEnvValue !== undefined) {
		return {
			args,
			command,
			env,
			failure: createFailure(
				'invalid-input',
				'Environment overrides must use valid keys and string values without NUL bytes.',
				null,
				null,
			),
			maxOutputBytes,
			redactValues,
		};
	}

	if (
		!Number.isInteger(maxOutputBytes) ||
		maxOutputBytes < 1 ||
		maxOutputBytes > Number.MAX_SAFE_INTEGER
	) {
		return {
			args,
			command,
			env,
			failure: createFailure(
				'invalid-input',
				'maxOutputBytes must be a positive integer.',
				null,
				null,
			),
			maxOutputBytes,
			redactValues,
		};
	}

	if (
		request.timeoutMs !== undefined &&
		(!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1)
	) {
		return {
			args,
			command,
			env,
			failure: createFailure(
				'invalid-input',
				'timeoutMs must be a positive integer when provided.',
				null,
				null,
			),
			maxOutputBytes,
			redactValues,
		};
	}

	return {
		args,
		command,
		cwd: request.cwd,
		env,
		maxOutputBytes,
		redactValues,
		timeoutMs: request.timeoutMs,
	};
}

/**
 * Resolves the candidate working directory and confirms it exists.
 * @param cwd - Candidate path.
 * @returns The resolved absolute path plus an optional failure.
 */
function validateCwd(cwd: string): {
	failure?: LocalCommandFailure;
	path: string;
} {
	if (!cwd || cwd.includes('\u0000')) {
		return {
			failure: createFailure(
				'invalid-cwd',
				'Command cwd must be a valid directory path.',
				null,
				null,
			),
			path: cwd,
		};
	}

	const resolvedPath = path.resolve(cwd);

	try {
		if (!statSync(resolvedPath).isDirectory()) {
			return {
				failure: createFailure(
					'invalid-cwd',
					'Command cwd must point to an existing directory.',
					null,
					null,
				),
				path: resolvedPath,
			};
		}
	} catch {
		return {
			failure: createFailure(
				'invalid-cwd',
				'Command cwd must point to an existing directory.',
				null,
				null,
			),
			path: resolvedPath,
		};
	}

	return { path: resolvedPath };
}

/**
 * Spawns the child process, captures stdout/stderr under the output cap,
 * enforces the timeout/abort signal, and resolves once the process exits.
 * @param input - Pre-validated command, environment and limits.
 * @returns A {@link LocalCommandResult} for the completed (or terminated) process.
 */
function runSpawnedCommand({
	args,
	command,
	cwd,
	environment,
	env,
	killGraceMs,
	maxOutputBytes,
	redactValues,
	signal,
	startedAt,
	startedMs,
	timeoutMs,
}: {
	args: string[];
	command: string;
	cwd: string;
	environment: CommandEnvironmentSnapshot;
	env: Record<string, string>;
	killGraceMs: number;
	maxOutputBytes: number;
	redactValues: readonly string[];
	signal?: AbortSignal;
	startedAt: string;
	startedMs: number;
	timeoutMs?: number;
}): Promise<LocalCommandResult> {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			cwd,
			env,
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const stderrChunks: Buffer[] = [];
		const stdoutChunks: Buffer[] = [];
		let exitCode: number | null = null;
		let settled = false;
		let signalCode: NodeJS.Signals | string | null = null;
		let stderrBytes = 0;
		let stderrTruncated = false;
		let stdoutBytes = 0;
		let stdoutTruncated = false;
		let terminationReason: TerminationReason | null = null;
		let killTimer: NodeJS.Timeout | null = null;
		let timeoutTimer: NodeJS.Timeout | null = null;

		/**
		 * Resolves the outer promise exactly once, clearing pending timers and
		 * assembling the sanitized result.
		 * @param status - Final status to report.
		 * @param failure - Failure metadata when `status` is `failure`.
		 */
		function settle(
			status: LocalCommandStatus,
			failure?: LocalCommandFailure,
		): void {
			if (settled) {
				return;
			}

			settled = true;

			if (killTimer) {
				clearTimeout(killTimer);
			}

			if (timeoutTimer) {
				clearTimeout(timeoutTimer);
			}

			signal?.removeEventListener('abort', abortListener);

			const stdout = Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8');
			const stderr = Buffer.concat(stderrChunks, stderrBytes).toString('utf8');

			resolve(
				createLocalCommandResult({
					args,
					command,
					cwd,
					environment,
					exitCode,
					failure,
					logs: createSanitizedLogs({
						args,
						command,
						cwd,
						env,
						redactValues,
						stderr,
						stdout,
					}),
					signal: signalCode,
					startedAt,
					startedMs,
					status,
					stderr,
					stderrTruncated,
					stdout,
					stdoutTruncated,
				}),
			);
		}

		/**
		 * Sends SIGTERM and schedules a SIGKILL fallback, recording the
		 * termination cause for the eventual failure reason.
		 * @param reason - Why the command is being terminated.
		 */
		function terminate(reason: TerminationReason): void {
			if (terminationReason) {
				return;
			}

			terminationReason = reason;

			if (child.exitCode !== null || child.killed) {
				return;
			}

			child.kill('SIGTERM');
			killTimer = setTimeout(() => {
				if (child.exitCode === null) {
					child.kill('SIGKILL');
				}
			}, killGraceMs);
		}

		/** Abort-signal handler that cancels the running command. */
		function abortListener(): void {
			terminate('canceled');
		}

		/**
		 * Appends a chunk to the per-stream buffer, applying the output cap and
		 * triggering termination on overflow.
		 * @param stream - Which stream produced the chunk.
		 * @param chunk - Raw bytes from the stream.
		 */
		function captureChunk(stream: 'stderr' | 'stdout', chunk: Buffer): void {
			const chunks = stream === 'stdout' ? stdoutChunks : stderrChunks;
			const currentBytes = stream === 'stdout' ? stdoutBytes : stderrBytes;
			const remainingBytes = maxOutputBytes - currentBytes;

			if (remainingBytes <= 0) {
				if (stream === 'stdout') {
					stdoutTruncated = true;
				} else {
					stderrTruncated = true;
				}
				terminate('output-truncated');
				return;
			}

			if (chunk.byteLength > remainingBytes) {
				chunks.push(chunk.subarray(0, remainingBytes));

				if (stream === 'stdout') {
					stdoutBytes += remainingBytes;
					stdoutTruncated = true;
				} else {
					stderrBytes += remainingBytes;
					stderrTruncated = true;
				}

				terminate('output-truncated');
				return;
			}

			chunks.push(chunk);

			if (stream === 'stdout') {
				stdoutBytes += chunk.byteLength;
			} else {
				stderrBytes += chunk.byteLength;
			}
		}

		signal?.addEventListener('abort', abortListener, { once: true });

		if (timeoutMs !== undefined) {
			timeoutTimer = setTimeout(() => terminate('timeout'), timeoutMs);
		}

		child.stdout?.on('data', (chunk: Buffer) => {
			captureChunk('stdout', chunk);
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			captureChunk('stderr', chunk);
		});
		child.on('error', (error) => {
			const code = getErrorCode(error);
			const failure =
				code === 'ENOENT'
					? createFailure(
							'command-not-found',
							`Command not found: ${command}.`,
							null,
							null,
						)
					: createFailure(
							'spawn-error',
							`Failed to start command: ${error.message}`,
							null,
							null,
						);

			settle('failure', failure);
		});
		child.on('close', (closedExitCode, closedSignal) => {
			exitCode = closedExitCode;
			signalCode = closedSignal;

			if (terminationReason) {
				settle(
					'failure',
					createFailure(
						terminationReason,
						createTerminationMessage(terminationReason),
						exitCode,
						signalCode,
					),
				);
				return;
			}

			if (exitCode === 0) {
				settle('success');
				return;
			}

			settle(
				'failure',
				createFailure(
					'nonzero-exit',
					`Command exited with code ${String(exitCode)}.`,
					exitCode,
					signalCode,
				),
			);
		});
	});
}

/**
 * Resolves the command environment by invoking the configured shell loader,
 * recording diagnostics on each failure mode and falling back to the Electron
 * process environment when the shell cannot be consulted.
 * @param input - Loader dependencies and configuration.
 * @returns The resolved environment snapshot.
 */
async function resolveCommandEnvironment({
	baseEnv,
	commonPathEntries,
	environmentTimeoutMs,
	now,
	shell,
	shellEnvironmentLoader,
}: {
	baseEnv: Record<string, string>;
	commonPathEntries: readonly string[];
	environmentTimeoutMs: number;
	now: () => Date;
	shell: string;
	shellEnvironmentLoader: ShellEnvironmentLoader;
}): Promise<CommandEnvironmentSnapshot> {
	const diagnostics: CommandEnvironmentDiagnostic[] = [];

	try {
		const result = await shellEnvironmentLoader({
			baseEnv,
			shell,
			timeoutMs: environmentTimeoutMs,
		});

		if (result.timedOut) {
			diagnostics.push({
				code: 'shell-env-timeout',
				message: 'Shell environment resolution timed out.',
				severity: 'warning',
			});
		} else if (result.error) {
			diagnostics.push({
				code: 'shell-env-error',
				message: 'Shell environment resolution failed to start.',
				severity: 'warning',
			});
		} else if (result.exitCode !== 0) {
			diagnostics.push({
				code: 'shell-env-exit',
				message: `Shell environment resolution exited with code ${String(result.exitCode)}.`,
				severity: 'warning',
			});
		} else {
			const parsedEnv = parseShellEnvironmentOutput(result.stdout);

			if (parsedEnv) {
				const env = ensureEnvironmentPath(parsedEnv, commonPathEntries);

				return {
					diagnostics,
					env,
					path: env.PATH ?? '',
					resolvedAt: now().toISOString(),
					shell,
					source: 'shell',
				};
			}

			diagnostics.push({
				code: 'shell-env-unparseable',
				message:
					'Shell environment resolution did not return parseable sentinel output.',
				severity: 'warning',
			});
		}
	} catch {
		diagnostics.push({
			code: 'shell-env-error',
			message: 'Shell environment resolution failed unexpectedly.',
			severity: 'warning',
		});
	}

	diagnostics.push({
		code: 'shell-env-fallback',
		message:
			'Using Electron process environment with common PATH entries as a fallback.',
		severity: 'warning',
	});

	const env = ensureEnvironmentPath(baseEnv, commonPathEntries);

	return {
		diagnostics,
		env,
		path: env.PATH ?? '',
		resolvedAt: now().toISOString(),
		shell,
		source: 'fallback',
	};
}

/**
 * Default {@link ShellEnvironmentLoader} that spawns the configured login shell
 * and prints sentinel-delimited NUL-separated environment entries to stdout.
 * @param input - Loader request.
 * @returns Captured exit metadata and stdout/stderr.
 */
function loadShellEnvironment({
	baseEnv,
	shell,
	timeoutMs,
}: ShellEnvironmentLoaderRequest): Promise<ShellEnvironmentLoaderResult> {
	return new Promise((resolve) => {
		const child = spawn(
			shell,
			[
				'-lic',
				`printf '%s\\0' '${SHELL_ENVIRONMENT_BEGIN_SENTINEL}'; /usr/bin/env -0; printf '%s\\0' '${SHELL_ENVIRONMENT_END_SENTINEL}'`,
			],
			{
				env: baseEnv,
				shell: false,
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		);
		const stderrChunks: Buffer[] = [];
		const stdoutChunks: Buffer[] = [];
		let settled = false;
		let timedOut = false;

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGTERM');
		}, timeoutMs);

		/**
		 * Resolves the loader promise exactly once.
		 * @param result - Loader result to surface.
		 */
		function settle(result: ShellEnvironmentLoaderResult): void {
			if (settled) {
				return;
			}

			settled = true;
			clearTimeout(timer);
			resolve(result);
		}

		child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
		child.on('error', (error) => {
			settle({
				error,
				exitCode: null,
				signal: null,
				stderr: Buffer.concat(stderrChunks).toString('utf8'),
				stdout: Buffer.concat(stdoutChunks).toString('utf8'),
				timedOut,
			});
		});
		child.on('close', (exitCode, signal) => {
			settle({
				exitCode,
				signal,
				stderr: Buffer.concat(stderrChunks).toString('utf8'),
				stdout: Buffer.concat(stdoutChunks).toString('utf8'),
				timedOut,
			});
		});
	});
}

/**
 * Parses sentinel-delimited NUL-separated environment dump produced by the
 * default shell loader.
 * @param stdout - Captured shell stdout.
 * @returns A `KEY=value` map, or `null` when sentinels are missing/malformed.
 */
function parseShellEnvironmentOutput(
	stdout: string,
): Record<string, string> | null {
	const fields = stdout.split('\u0000');
	const beginIndex = fields.indexOf(SHELL_ENVIRONMENT_BEGIN_SENTINEL);

	if (beginIndex === -1) {
		return null;
	}

	const endIndex = fields.indexOf(
		SHELL_ENVIRONMENT_END_SENTINEL,
		beginIndex + 1,
	);

	if (endIndex === -1 || endIndex <= beginIndex) {
		return null;
	}

	const env: Record<string, string> = {};

	for (const field of fields.slice(beginIndex + 1, endIndex)) {
		const separatorIndex = field.indexOf('=');

		if (separatorIndex <= 0) {
			continue;
		}

		const key = field.slice(0, separatorIndex);

		if (!key || key.includes('\u0000')) {
			continue;
		}

		env[key] = field.slice(separatorIndex + 1);
	}

	return Object.keys(env).length > 0 ? env : null;
}

/**
 * Filters an environment map to entries with safe keys and string values,
 * rejecting NUL bytes and `=` in keys.
 * @param env - Environment to normalise.
 * @returns A new map containing only safe entries.
 */
function normalizeEnvironment(
	env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string> {
	const normalized: Record<string, string> = {};

	for (const [key, value] of Object.entries(env)) {
		if (
			key &&
			!key.includes('=') &&
			!key.includes('\u0000') &&
			typeof value === 'string' &&
			!value.includes('\u0000')
		) {
			normalized[key] = value;
		}
	}

	return normalized;
}

/**
 * Returns a clone of `env` with its `PATH` augmented by the common path entries.
 * @param env - Base environment.
 * @param commonPathEntries - Entries to append to `PATH` when missing.
 * @returns The augmented environment.
 */
function ensureEnvironmentPath(
	env: Record<string, string>,
	commonPathEntries: readonly string[],
): Record<string, string> {
	return {
		...env,
		PATH: mergePath(env.PATH, commonPathEntries),
	};
}

/**
 * Applies caller overrides onto a base environment; `null`/`undefined` entries
 * delete the matching key.
 * @param env - Base environment.
 * @param overrides - Caller-supplied overrides.
 * @returns A new environment with overrides applied.
 */
function mergeEnvironment(
	env: Record<string, string>,
	overrides: Record<string, string | null | undefined>,
): Record<string, string> {
	const merged = { ...env };

	for (const [key, value] of Object.entries(overrides)) {
		if (value === null || value === undefined) {
			delete merged[key];
			continue;
		}

		merged[key] = value;
	}

	return merged;
}

/**
 * Merges a `PATH` string with extra entries while preserving order and
 * deduplicating.
 * @param pathValue - Existing PATH value, possibly undefined.
 * @param commonPathEntries - Entries to append when not already present.
 * @returns The combined PATH string.
 */
function mergePath(
	pathValue: string | undefined,
	commonPathEntries: readonly string[],
): string {
	const entries = (pathValue ?? '')
		.split(path.delimiter)
		.map((entry) => entry.trim())
		.filter(Boolean);
	const seen = new Set(entries);

	for (const entry of commonPathEntries) {
		if (!seen.has(entry)) {
			entries.push(entry);
			seen.add(entry);
		}
	}

	return entries.join(path.delimiter);
}

/**
 * Picks the login shell to consult, preferring `$SHELL` and falling back to
 * platform defaults.
 * @param baseEnv - Process environment to inspect.
 * @returns Absolute path to the shell.
 */
function resolveDefaultShell(baseEnv: Record<string, string>): string {
	if (baseEnv.SHELL) {
		return baseEnv.SHELL;
	}

	if (process.platform === 'darwin') {
		return '/bin/zsh';
	}

	return '/bin/sh';
}

/**
 * Returns the platform-appropriate PATH entries appended to the shell PATH.
 * @returns A readonly array of directory paths.
 */
function getDefaultCommonPathEntries(): readonly string[] {
	if (process.platform === 'darwin') {
		return [
			'/opt/homebrew/bin',
			'/usr/local/bin',
			'/usr/bin',
			'/bin',
			'/usr/sbin',
			'/sbin',
		];
	}

	return ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
}

/**
 * Returns a deep clone of an environment snapshot so callers can mutate it safely.
 * @param snapshot - Snapshot to clone.
 * @returns A new snapshot whose nested collections are fresh copies.
 */
function cloneEnvironmentSnapshot(
	snapshot: CommandEnvironmentSnapshot,
): CommandEnvironmentSnapshot {
	return {
		...snapshot,
		diagnostics: snapshot.diagnostics.map((diagnostic) => ({ ...diagnostic })),
		env: { ...snapshot.env },
	};
}

/**
 * Assembles the final {@link LocalCommandResult} from spawn-side data and the
 * sanitized log payload.
 * @param input - Result fields plus performance timestamps.
 * @returns The fully populated result.
 */
function createLocalCommandResult({
	args,
	command,
	cwd,
	environment,
	exitCode,
	failure,
	logs,
	signal,
	startedAt,
	startedMs,
	status,
	stderr,
	stderrTruncated,
	stdout,
	stdoutTruncated,
}: {
	args: string[];
	command: string;
	cwd: string;
	environment: CommandEnvironmentSnapshot | null;
	exitCode: number | null;
	failure?: LocalCommandFailure;
	logs: LocalCommandSanitizedLogs;
	signal: NodeJS.Signals | string | null;
	startedAt: string;
	startedMs: number;
	status: LocalCommandStatus;
	stderr: string;
	stderrTruncated: boolean;
	stdout: string;
	stdoutTruncated: boolean;
}): LocalCommandResult {
	return {
		args,
		command,
		cwd,
		durationMs: Math.max(0, Math.round(performance.now() - startedMs)),
		endedAt: new Date().toISOString(),
		environment,
		exitCode,
		...(failure ? { failure } : {}),
		logs,
		signal,
		startedAt,
		status,
		stderr,
		stderrTruncated,
		stdout,
		stdoutTruncated,
	};
}

/**
 * Builds a {@link LocalCommandFailure} record.
 * @param code - Failure category.
 * @param message - Human-readable message.
 * @param exitCode - Observed exit code, if any.
 * @param signal - Terminating signal, if any.
 * @returns The failure record.
 */
function createFailure(
	code: LocalCommandFailureCode,
	message: string,
	exitCode: number | null,
	signal: NodeJS.Signals | string | null,
): LocalCommandFailure {
	return {
		code,
		exitCode,
		message,
		signal,
	};
}

/**
 * Maps a termination cause to a human-readable failure message.
 * @param reason - Why the command was terminated.
 * @returns The corresponding message.
 */
function createTerminationMessage(reason: TerminationReason): string {
	switch (reason) {
		case 'canceled':
			return 'The command was canceled.';
		case 'output-truncated':
			return 'The command exceeded the output capture limit.';
		case 'timeout':
			return 'The command timed out.';
	}
}

/**
 * Builds the sanitized log payload by redacting secrets in every textual field.
 * @param input - Raw command, args, env and output streams.
 * @returns A {@link LocalCommandSanitizedLogs} payload safe to persist.
 */
function createSanitizedLogs({
	args,
	command,
	cwd,
	env,
	redactValues = [],
	stderr,
	stdout,
}: {
	args: readonly string[];
	command: string;
	cwd: string;
	env: Record<string, string>;
	redactValues?: readonly string[];
	stderr: string;
	stdout: string;
}): LocalCommandSanitizedLogs {
	const redactor = createRedactor(env, redactValues);

	return {
		command: formatCommandLabel(command, args, redactor),
		cwd: redactor.redact(cwd),
		env: sanitizeEnvironment(env, redactor),
		stderr: redactor.redact(stderr),
		stdout: redactor.redact(stdout),
	};
}

/**
 * Builds a redactor that replaces sensitive environment values and inline
 * secret-shaped assignments with a placeholder.
 * @param env - Environment to scan for sensitive entries.
 * @param explicitValues - Caller-supplied secret values to redact.
 * @returns A `{ redact }` helper.
 */
function createRedactor(
	env: Record<string, string>,
	explicitValues: readonly string[],
): { redact: (value: string) => string } {
	const sensitiveValues = new Set<string>();

	for (const [key, value] of Object.entries(env)) {
		if (isSensitiveKey(key) && value.length >= 4) {
			sensitiveValues.add(value);
		}
	}

	for (const value of explicitValues) {
		if (value.length >= 4) {
			sensitiveValues.add(value);
		}
	}

	const values = Array.from(sensitiveValues).sort(
		(left, right) => right.length - left.length,
	);

	return {
		/**
		 * Returns the input with all known secret values and inline secret
		 * assignments replaced by the redaction placeholder.
		 * @param value - Text to redact.
		 * @returns Redacted text.
		 */
		redact(value) {
			let redacted = value;

			for (const sensitiveValue of values) {
				redacted = redacted.split(sensitiveValue).join(REDACTED);
			}

			return redacted.replace(
				SENSITIVE_ASSIGNMENT_PATTERN,
				(_match, key: string, separator: string, quote: string) =>
					`${key}${separator}${quote}${REDACTED}`,
			);
		},
	};
}

/**
 * Returns a sorted clone of `env` where sensitive keys are wholly redacted and
 * other values pass through the redactor.
 * @param env - Environment to sanitize.
 * @param redactor - Redactor used for non-sensitive values.
 * @returns The sanitized environment map.
 */
function sanitizeEnvironment(
	env: Record<string, string>,
	redactor: { redact: (value: string) => string },
): Record<string, string> {
	const sanitized: Record<string, string> = {};

	for (const key of Object.keys(env).sort()) {
		sanitized[key] = isSensitiveKey(key) ? REDACTED : redactor.redact(env[key]);
	}

	return sanitized;
}

/**
 * Renders the command line as a shell-safe, redacted single-line string.
 * @param command - Command executable.
 * @param args - Positional arguments.
 * @param redactor - Redactor applied to each rendered part.
 * @returns The sanitized command line.
 */
function formatCommandLabel(
	command: string,
	args: readonly string[],
	redactor: { redact: (value: string) => string },
): string {
	return [command, ...sanitizeArgs(args, redactor)]
		.map((part) => quoteCommandPart(redactor.redact(part)))
		.join(' ');
}

/**
 * Redacts argument values that follow a known secret-shaped flag and any inline
 * `--secret=value` arguments.
 * @param args - Positional arguments.
 * @param redactor - Redactor for arguments that don't match the secret patterns.
 * @returns A new array of sanitized arguments.
 */
function sanitizeArgs(
	args: readonly string[],
	redactor: { redact: (value: string) => string },
): string[] {
	const sanitized: string[] = [];
	let redactNext = false;

	for (const arg of args) {
		if (redactNext) {
			sanitized.push(REDACTED);
			redactNext = false;
			continue;
		}

		if (isSensitiveFlag(arg)) {
			sanitized.push(arg);
			redactNext = true;
			continue;
		}

		sanitized.push(redactSensitiveInlineArg(arg, redactor));
	}

	return sanitized;
}

/**
 * Tests whether an argument looks like a `--secret`-style flag whose value
 * should be redacted in the following position.
 * @param arg - Argument to test.
 * @returns True for flag-shaped, secret-named arguments.
 */
function isSensitiveFlag(arg: string): boolean {
	if (!arg.startsWith('-') || arg.includes('=')) {
		return false;
	}

	return isSensitiveKey(arg.replace(/^-+/, ''));
}

/**
 * Redacts a single inline `key=value` argument when the key matches a known
 * sensitive name; otherwise defers to the generic redactor.
 * @param arg - Argument to consider.
 * @param redactor - Fallback redactor.
 * @returns The (possibly) redacted argument.
 */
function redactSensitiveInlineArg(
	arg: string,
	redactor: { redact: (value: string) => string },
): string {
	const separatorIndex = arg.indexOf('=');

	if (separatorIndex > 0 && isSensitiveKey(arg.slice(0, separatorIndex))) {
		return `${arg.slice(0, separatorIndex + 1)}${REDACTED}`;
	}

	return redactor.redact(arg);
}

/**
 * Quotes a command-line token for safe shell rendering, escaping single quotes.
 * @param part - Token to quote.
 * @returns A shell-safe representation of `part`.
 */
function quoteCommandPart(part: string): string {
	if (part === '') {
		return "''";
	}

	if (/^[A-Za-z0-9_./:=@%+-]+$/.test(part)) {
		return part;
	}

	return `'${part.replace(/'/g, "'\\''")}'`;
}

/**
 * Tests whether a key name looks sensitive (e.g. contains "token" or "secret").
 * @param key - Key to test.
 * @returns True when the normalised key contains a sensitive substring.
 */
function isSensitiveKey(key: string): boolean {
	const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');

	return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

/**
 * Extracts the conventional Node.js `code` property from an error, if any.
 * @param error - Error instance to inspect.
 * @returns The `code` string, or `undefined`.
 */
function getErrorCode(error: Error): string | undefined {
	return 'code' in error && typeof error.code === 'string'
		? error.code
		: undefined;
}
