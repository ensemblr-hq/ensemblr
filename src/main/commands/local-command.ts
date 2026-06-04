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

export interface CommandEnvironmentDiagnostic {
	code: string;
	message: string;
	severity: CommandDiagnosticSeverity;
}

export interface CommandEnvironmentSnapshot {
	diagnostics: CommandEnvironmentDiagnostic[];
	env: Record<string, string>;
	path: string;
	resolvedAt: string;
	shell: string;
	source: CommandEnvironmentSource;
}

export interface LocalCommandRequest {
	args?: readonly string[];
	command: string;
	cwd?: string;
	env?: Record<string, string | null | undefined>;
	maxOutputBytes?: number;
	redactValues?: readonly string[];
	timeoutMs?: number;
}

export interface LocalCommandFailure {
	code: LocalCommandFailureCode;
	exitCode: number | null;
	message: string;
	signal: NodeJS.Signals | string | null;
}

export interface LocalCommandSanitizedLogs {
	command: string;
	cwd: string;
	env: Record<string, string>;
	stderr: string;
	stdout: string;
}

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

export interface LocalCommandRunOptions {
	signal?: AbortSignal;
}

export interface LocalCommandService {
	getEnvironment: () => Promise<CommandEnvironmentSnapshot>;
	run: (
		request: LocalCommandRequest,
		options?: LocalCommandRunOptions,
	) => Promise<LocalCommandResult>;
}

export interface ShellEnvironmentLoaderRequest {
	baseEnv: Record<string, string>;
	shell: string;
	timeoutMs: number;
}

export interface ShellEnvironmentLoaderResult {
	error?: Error;
	exitCode: number | null;
	signal: NodeJS.Signals | string | null;
	stderr: string;
	stdout: string;
	timedOut?: boolean;
}

export type ShellEnvironmentLoader = (
	request: ShellEnvironmentLoaderRequest,
) => Promise<ShellEnvironmentLoaderResult>;

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
const SHELL_ENVIRONMENT_BEGIN_SENTINEL = '__PIDUCTOR_SHELL_ENV_BEGIN__';
const SHELL_ENVIRONMENT_END_SENTINEL = '__PIDUCTOR_SHELL_ENV_END__';
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

	async function run(
		request: LocalCommandRequest,
		runOptions: LocalCommandRunOptions = {},
	): Promise<LocalCommandResult> {
		const input = normalizeLocalCommandRequest(request);

		if (input.failure) {
			return createLocalCommandResult({
				args: input.args,
				command: input.command,
				cwd: input.cwd ?? process.cwd(),
				environment: null,
				exitCode: null,
				failure: input.failure,
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
		}

		const cwd = validateCwd(input.cwd ?? process.cwd());

		if (cwd.failure) {
			return createLocalCommandResult({
				args: input.args,
				command: input.command,
				cwd: input.cwd ?? process.cwd(),
				environment: null,
				exitCode: null,
				failure: cwd.failure,
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

		function abortListener(): void {
			terminate('canceled');
		}

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

function ensureEnvironmentPath(
	env: Record<string, string>,
	commonPathEntries: readonly string[],
): Record<string, string> {
	return {
		...env,
		PATH: mergePath(env.PATH, commonPathEntries),
	};
}

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

function resolveDefaultShell(baseEnv: Record<string, string>): string {
	if (baseEnv.SHELL) {
		return baseEnv.SHELL;
	}

	if (process.platform === 'darwin') {
		return '/bin/zsh';
	}

	return '/bin/sh';
}

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

function cloneEnvironmentSnapshot(
	snapshot: CommandEnvironmentSnapshot,
): CommandEnvironmentSnapshot {
	return {
		...snapshot,
		diagnostics: snapshot.diagnostics.map((diagnostic) => ({ ...diagnostic })),
		env: { ...snapshot.env },
	};
}

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

function formatCommandLabel(
	command: string,
	args: readonly string[],
	redactor: { redact: (value: string) => string },
): string {
	return [command, ...sanitizeArgs(args, redactor)]
		.map((part) => quoteCommandPart(redactor.redact(part)))
		.join(' ');
}

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

function isSensitiveFlag(arg: string): boolean {
	if (!arg.startsWith('-') || arg.includes('=')) {
		return false;
	}

	return isSensitiveKey(arg.replace(/^-+/, ''));
}

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

function quoteCommandPart(part: string): string {
	if (part === '') {
		return "''";
	}

	if (/^[A-Za-z0-9_./:=@%+-]+$/.test(part)) {
		return part;
	}

	return `'${part.replace(/'/g, "'\\''")}'`;
}

function isSensitiveKey(key: string): boolean {
	const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');

	return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function getErrorCode(error: Error): string | undefined {
	return 'code' in error && typeof error.code === 'string'
		? error.code
		: undefined;
}
