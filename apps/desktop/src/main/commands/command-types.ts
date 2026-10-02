/** Where a resolved command environment came from: the user's shell or a built-in fallback. */
export type CommandEnvironmentSource = 'fallback' | 'shell';
/** Severity of a diagnostic emitted while resolving the command environment. */
export type CommandDiagnosticSeverity = 'info' | 'warning';
/** Terminal status of a local command run. */
export type LocalCommandStatus = 'failure' | 'success';

/** Reason code describing why a local command failed. */
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
	getEnvironment: (cwd?: string) => Promise<CommandEnvironmentSnapshot>;
	run: (
		request: LocalCommandRequest,
		options?: LocalCommandRunOptions,
	) => Promise<LocalCommandResult>;
}

/** Input passed to a {@link ShellEnvironmentLoader}. */
export interface ShellEnvironmentLoaderRequest {
	baseEnv: Record<string, string>;
	/**
	 * Directory to run the login shell in. Lets directory-aware version managers
	 * (mise, fnm, asdf, volta) resolve the toolchain pinned for that directory.
	 * Omitted resolves in the Electron process's working directory.
	 */
	cwd?: string;
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
	/**
	 * Minimum gap between shell retries after a fallback resolution. A failed or
	 * timed-out login shell caches its fallback for this window instead of
	 * re-spawning on every lookup, so a persistently slow shell cannot storm the
	 * user's machine with interactive-shell spawns (each of which is a chance for
	 * macOS to relaunch Ensemblr as a stray second instance).
	 */
	fallbackRetryCooldownMs?: number;
	killGraceMs?: number;
	now?: () => Date;
	shell?: string;
	shellEnvironmentLoader?: ShellEnvironmentLoader;
}

/** Internal: classification used to drive child-process termination. */
export type TerminationReason = 'canceled' | 'output-truncated' | 'timeout';
