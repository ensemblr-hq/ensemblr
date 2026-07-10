import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import type { CommandEnvironmentSnapshot } from '../commands/local-command.ts';
import { stripLaunchContextEnv } from '../environment/launch-env.ts';
import { createJsonlLineStream } from '../pi-ipc/jsonl-line-stream.ts';
import type { EnsemblrRootDirectoryService } from '../root/root-directory-service.ts';
import {
	isExecutableReady,
	type PiExecutableSnapshot,
} from './pi-executable.ts';
import type {
	PiRpcFrameSnapshot,
	PiRpcSmokeFailure,
	PiRpcSmokeFailureCode,
	PiRpcSmokeRunner,
	PiRpcSmokeRunnerRequest,
	PiRpcSmokeSnapshot,
} from './pi-runtime-types.ts';

const DEFAULT_RPC_TIMEOUT_MS = 5000;
const DEFAULT_RPC_KILL_GRACE_MS = 500;
const DEFAULT_RPC_MAX_OUTPUT_BYTES = 64 * 1024;
const PI_RPC_ARGS = ['--mode', 'rpc'] as const;
const SETUP_SMOKE_WORKSPACE_DIRECTORY = '.setup-smoke';

/**
 * Runs the Pi RPC startup smoke check (or returns a synthetic failure when the
 * executable or smoke workspace is unavailable).
 * @param input - Environment, executable, smoke workspace, and tuning.
 * @returns A {@link PiRpcSmokeSnapshot}.
 */
export async function resolvePiRpcSmoke({
	environment,
	executable,
	killGraceMs = DEFAULT_RPC_KILL_GRACE_MS,
	maxOutputBytes = DEFAULT_RPC_MAX_OUTPUT_BYTES,
	now = () => new Date(),
	rpcRunner = runPiRpcSmokeProcess,
	smokeWorkspace,
	timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
}: {
	environment: CommandEnvironmentSnapshot;
	executable: PiExecutableSnapshot;
	killGraceMs?: number;
	maxOutputBytes?: number;
	now?: () => Date;
	rpcRunner?: PiRpcSmokeRunner;
	smokeWorkspace: { error?: string; path: string };
	timeoutMs?: number;
}): Promise<PiRpcSmokeSnapshot> {
	if (!isExecutableReady(executable)) {
		return createFailedRpcSnapshot({
			code: 'executable-not-ready',
			command: executable.command,
			cwd: smokeWorkspace.path,
			message:
				executable.diagnostics.find(
					(diagnostic) => diagnostic.severity === 'error',
				)?.message ?? 'Pi executable is not ready enough to start RPC mode.',
			now,
		});
	}

	if (smokeWorkspace.error) {
		return createFailedRpcSnapshot({
			code: 'smoke-workspace-unavailable',
			command: executable.command,
			cwd: smokeWorkspace.path,
			message: smokeWorkspace.error,
			now,
		});
	}

	return rpcRunner({
		args: PI_RPC_ARGS,
		command: executable.command,
		cwd: smokeWorkspace.path,
		env: environment.env,
		killGraceMs,
		maxOutputBytes,
		now,
		timeoutMs,
	});
}

/**
 * Default {@link PiRpcSmokeRunner} that spawns `pi --mode rpc`, watches stdout
 * for the first valid JSONL frame, enforces an output cap and a timeout, and
 * terminates the process group when finished.
 * @param request - Spawn args, environment, and tuning.
 * @returns A {@link PiRpcSmokeSnapshot}.
 */
export function runPiRpcSmokeProcess({
	args,
	command,
	cwd,
	env,
	killGraceMs,
	maxOutputBytes,
	now,
	timeoutMs,
}: PiRpcSmokeRunnerRequest): Promise<PiRpcSmokeSnapshot> {
	const startedAt = now().toISOString();
	const startedMs = performance.now();

	return new Promise((resolve) => {
		const shouldDetachChild = process.platform !== 'win32';
		const child = spawn(command, Array.from(args), {
			cwd,
			detached: shouldDetachChild,
			// Final boundary strip, mirroring buildSpawnEnv for the real pi spawn:
			// the smoke child (and any extension it spawns) must never inherit this
			// app's macOS/Electron launch identity either.
			env: stripLaunchContextEnv(env),
			shell: false,
			// Open stdin as a pipe — Pi's RPC mode reads commands from stdin
			// and exits silently on EOF. We send one probe frame below to
			// elicit any JSONL response (success or structured error) which
			// proves the RPC loop is alive.
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		try {
			// `{"type":"prompt"}` with no `message` makes Pi reply with a
			// structured `{"type":"response","success":false,"error":"..."}`
			// frame — still valid JSONL, satisfies the smoke check, and avoids
			// triggering an actual model call.
			child.stdin?.write('{"type":"prompt"}\n');
			child.stdin?.end();
		} catch {
			// stdin may already be closed if spawn failed; exit handler covers it.
		}
		let endedAt = startedAt;
		let exitCode: number | null = null;
		let failure: PiRpcSmokeFailure | undefined;
		let firstFrame: PiRpcFrameSnapshot | undefined;
		let settled = false;
		let signalCode: NodeJS.Signals | string | null = null;
		let stderr = '';
		let stderrTruncated = false;
		let stdout = '';
		let stdoutTruncated = false;
		let killTimer: NodeJS.Timeout | null = null;

		// Shared LF-delimited line buffer. `onLine` is invoked once per complete
		// line in producer order; we discard empties and inspect the first
		// non-empty line as the JSONL probe frame. `maxLineBytes` is generous
		// because the smoke probe already enforces a per-stream byte cap above.
		const stdoutLineStream = createJsonlLineStream({
			maxLineBytes: maxOutputBytes,
			onLine: (line) => {
				const trimmed = line.trim();
				if (!trimmed) {
					return;
				}
				inspectRpcStdoutFrame(trimmed);
			},
		});
		const timeoutTimer = setTimeout(() => {
			failure ??= createRpcFailure({
				code: 'timeout',
				exitCode,
				message: 'Pi RPC startup timed out before producing valid JSONL.',
				signal: signalCode,
			});
			terminateChild();
		}, timeoutMs);

		/** Sends SIGTERM (and SIGKILL after the grace period) to the child process group. */
		function terminateChild(): void {
			if (killTimer || !isChildRunning()) {
				return;
			}

			signalChild('SIGTERM');
			killTimer = setTimeout(() => {
				if (isChildRunning()) {
					signalChild('SIGKILL');
				}
			}, killGraceMs);
		}

		/** True when the child is still alive and the promise has not resolved. */
		function isChildRunning(): boolean {
			return !settled && child.exitCode === null;
		}

		/**
		 * Sends a signal to the child, preferring the process group on POSIX so
		 * spawned subprocesses also receive it.
		 * @param signal - Signal name to send.
		 */
		function signalChild(signal: NodeJS.Signals): void {
			if (shouldDetachChild && child.pid) {
				try {
					process.kill(-child.pid, signal);
				} catch {
					// Fall back to terminating the direct child below.
				}
			}

			try {
				child.kill(signal);
			} catch {
				// The process may already have exited after the process-group signal.
			}
		}

		/** Resolves the outer promise exactly once, synthesising a failure if needed. */
		function settle(): void {
			if (settled) {
				return;
			}

			settled = true;
			clearTimeout(timeoutTimer);
			if (killTimer) {
				clearTimeout(killTimer);
			}
			endedAt = now().toISOString();

			if (!firstFrame && !failure) {
				failure = createRpcFailure({
					code: exitCode && exitCode !== 0 ? 'nonzero-exit' : 'no-jsonl',
					exitCode,
					message:
						exitCode && exitCode !== 0
							? `Pi RPC process exited with code ${String(exitCode)} before producing valid JSONL.`
							: 'Pi RPC process ended before producing valid JSONL.',
					signal: signalCode,
				});
			}

			resolve({
				args: Array.from(args),
				command,
				cwd,
				durationMs: performance.now() - startedMs,
				endedAt,
				failure,
				firstFrame,
				logs: {
					command: [command, ...args].join(' '),
					cwd,
					stderr,
					stdout,
				},
				signal: signalCode,
				startedAt,
				status: firstFrame ? 'success' : 'failure',
				stderrTruncated,
				stdoutTruncated,
			});
		}

		/**
		 * Appends a chunk to the per-stream buffer, enforces the output cap, and
		 * feeds new stdout content into the JSONL inspector.
		 * @param stream - Which stream produced the chunk.
		 * @param chunk - Raw bytes from the stream.
		 */
		function captureOutput(stream: 'stderr' | 'stdout', chunk: Buffer): void {
			const text = chunk.toString('utf8');
			const current = stream === 'stdout' ? stdout : stderr;
			const remainingBytes =
				maxOutputBytes - Buffer.byteLength(current, 'utf8');

			if (remainingBytes <= 0) {
				if (stream === 'stdout') {
					stdoutTruncated = true;
				} else {
					stderrTruncated = true;
				}

				failure ??= createRpcFailure({
					code: 'output-truncated',
					exitCode,
					message: 'Pi RPC startup produced too much output.',
					signal: signalCode,
				});
				terminateChild();
				return;
			}

			const nextText =
				Buffer.byteLength(text, 'utf8') > remainingBytes
					? Buffer.from(text).subarray(0, remainingBytes).toString('utf8')
					: text;

			if (stream === 'stdout') {
				stdout += nextText;
				stdoutTruncated ||= nextText.length !== text.length;
				stdoutLineStream.feed(nextText);
			} else {
				stderr += nextText;
				stderrTruncated ||= nextText.length !== text.length;
			}

			if (nextText.length !== text.length) {
				failure ??= createRpcFailure({
					code: 'output-truncated',
					exitCode,
					message: 'Pi RPC startup produced too much output.',
					signal: signalCode,
				});
				terminateChild();
			}
		}

		/**
		 * Inspects a single non-empty stdout line for the JSONL probe frame. Once
		 * the first frame has been captured, subsequent lines are ignored — the
		 * smoke check only cares about the first complete line. An invalid first
		 * line records the `invalid-jsonl` failure (overriding any earlier
		 * provisional failure such as `output-truncated`, matching the original
		 * single-pass inspector behaviour).
		 * @param line - A trimmed, non-empty stdout line.
		 */
		function inspectRpcStdoutFrame(line: string): void {
			if (firstFrame) {
				return;
			}

			const frame = parseRpcFrame(line);

			if (!frame) {
				failure = createRpcFailure({
					code: 'invalid-jsonl',
					exitCode,
					message: 'Pi RPC stdout produced a non-JSONL startup line.',
					signal: signalCode,
				});
				terminateChild();
				return;
			}

			firstFrame = frame;
			terminateChild();
		}

		child.stdout?.on('data', (chunk: Buffer) => captureOutput('stdout', chunk));
		child.stderr?.on('data', (chunk: Buffer) => captureOutput('stderr', chunk));
		child.on('error', (error) => {
			const code =
				getNodeErrorCode(error) === 'ENOENT'
					? 'command-not-found'
					: 'spawn-error';
			failure = createRpcFailure({
				code,
				exitCode,
				message:
					code === 'command-not-found'
						? `Command not found: ${command}.`
						: `Failed to start Pi RPC process: ${error.message}`,
				signal: signalCode,
			});
		});
		child.on('close', (closedExitCode, closedSignal) => {
			exitCode = closedExitCode;
			signalCode = closedSignal;
			settle();
		});
	});
}

/**
 * Ensures a dedicated `.setup-smoke` workspace exists under the root, used as
 * the cwd for the Pi RPC startup check.
 * @param rootDirectoryService - Active root-directory service.
 * @returns The workspace path plus any error encountered.
 */
export function ensureSetupSmokeWorkspace(
	rootDirectoryService: EnsemblrRootDirectoryService,
): { error?: string; path: string } {
	const rootSnapshot =
		rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();
	const smokeWorkspacePath = rootSnapshot.workspacesPath
		? path.join(rootSnapshot.workspacesPath, SETUP_SMOKE_WORKSPACE_DIRECTORY)
		: '';

	if (rootSnapshot.status === 'error') {
		return {
			error:
				rootSnapshot.diagnostics[0]?.message ??
				'Ensemblr root is not ready enough to create a Pi RPC smoke workspace.',
			path: smokeWorkspacePath,
		};
	}

	if (!smokeWorkspacePath) {
		return {
			error: 'Ensemblr workspaces path is unavailable for Pi RPC smoke checks.',
			path: smokeWorkspacePath,
		};
	}

	try {
		mkdirSync(smokeWorkspacePath, { recursive: true });
		return { path: smokeWorkspacePath };
	} catch (error) {
		return {
			error:
				error instanceof Error
					? error.message
					: 'Failed to create Pi RPC smoke workspace.',
			path: smokeWorkspacePath,
		};
	}
}

/**
 * Builds a failure-shaped RPC smoke snapshot for early-return paths.
 * @param input - Failure code, command, cwd, message and clock.
 * @returns A {@link PiRpcSmokeSnapshot} with `status: 'failure'`.
 */
function createFailedRpcSnapshot({
	code,
	command,
	cwd,
	message,
	now,
}: {
	code: PiRpcSmokeFailureCode;
	command: string;
	cwd: string;
	message: string;
	now: () => Date;
}): PiRpcSmokeSnapshot {
	const timestamp = now().toISOString();

	return {
		args: Array.from(PI_RPC_ARGS),
		command,
		cwd,
		durationMs: 0,
		endedAt: timestamp,
		failure: createRpcFailure({
			code,
			exitCode: null,
			message,
			signal: null,
		}),
		logs: {
			command: command ? [command, ...PI_RPC_ARGS].join(' ') : '',
			cwd,
			stderr: '',
			stdout: '',
		},
		signal: null,
		startedAt: timestamp,
		status: 'failure',
		stderrTruncated: false,
		stdoutTruncated: false,
	};
}

/** Builds a {@link PiRpcSmokeFailure} record. */
function createRpcFailure({
	code,
	exitCode,
	message,
	signal,
}: {
	code: PiRpcSmokeFailureCode;
	exitCode: number | null;
	message: string;
	signal: NodeJS.Signals | string | null;
}): PiRpcSmokeFailure {
	return {
		code,
		exitCode,
		message,
		signal,
	};
}

/**
 * Parses a single JSON line into a {@link PiRpcFrameSnapshot}.
 * @param line - A single line from `pi --mode rpc` stdout.
 * @returns The frame snapshot, or `null` on parse or shape failure.
 */
function parseRpcFrame(line: string): PiRpcFrameSnapshot | null {
	try {
		const parsed = JSON.parse(line) as unknown;

		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			'type' in parsed &&
			typeof parsed.type === 'string'
		) {
			return { type: parsed.type };
		}
	} catch {
		return null;
	}

	return null;
}

/** Extracts the Node.js `code` property from an error, if any. */
function getNodeErrorCode(error: Error): string | null {
	return 'code' in error && typeof error.code === 'string' ? error.code : null;
}
