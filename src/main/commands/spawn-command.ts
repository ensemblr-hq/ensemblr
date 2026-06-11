import { spawn } from 'node:child_process';

import { createSanitizedLogs } from './command-redaction.ts';
import {
	createFailure,
	createLocalCommandResult,
	createTerminationMessage,
	getErrorCode,
} from './command-result.ts';
import type {
	CommandEnvironmentSnapshot,
	LocalCommandFailure,
	LocalCommandResult,
	LocalCommandStatus,
	TerminationReason,
} from './command-types.ts';

/**
 * Spawns the child process, captures stdout/stderr under the output cap,
 * enforces the timeout/abort signal, and resolves once the process exits.
 * @param input - Pre-validated command, environment and limits.
 * @returns A {@link LocalCommandResult} for the completed (or terminated) process.
 */
export function runSpawnedCommand({
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
