import { performance } from 'node:perf_hooks';

import type {
	CommandEnvironmentSnapshot,
	LocalCommandFailure,
	LocalCommandFailureCode,
	LocalCommandResult,
	LocalCommandSanitizedLogs,
	LocalCommandStatus,
	TerminationReason,
} from './command-types.ts';

/**
 * Assembles the final {@link LocalCommandResult} from spawn-side data and the
 * sanitized log payload.
 * @param input - Result fields plus performance timestamps.
 * @returns The fully populated result.
 */
export function createLocalCommandResult({
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
export function createFailure(
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
export function createTerminationMessage(reason: TerminationReason): string {
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
 * Extracts the conventional Node.js `code` property from an error, if any.
 * @param error - Error instance to inspect.
 * @returns The `code` string, or `undefined`.
 */
export function getErrorCode(error: Error): string | undefined {
	return 'code' in error && typeof error.code === 'string'
		? error.code
		: undefined;
}
