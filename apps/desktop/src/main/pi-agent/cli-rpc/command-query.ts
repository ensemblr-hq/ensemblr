import { randomUUID } from 'node:crypto';
import { createKillTimer } from './kill-timer.ts';
import { createPiRpcLineStream } from './line-stream-handlers.ts';
import type { ChildLike, SpawnFn } from './spawn-env.ts';

const MAX_LINE_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * MAX_LINE_BYTES;
const CLOSE_GRACE_MS = 2000;
const PASSIVE_UI_METHODS = new Set([
	'notify',
	'setStatus',
	'setWidget',
	'setTitle',
	'set_editor_text',
]);

/**
 * Queries commands in an ephemeral RPC child using the adapter's spawn, framing,
 * and escalation facilities, without constructing an interactive agent session.
 * Startup dialogs fail closed; no prompt or UI response is ever sent.
 * @param input - Configured executable, resource argv, environment, and deadlines.
 * @returns The correlated get_commands payload, after the child is reaped.
 */
export function queryPiCommands({
	command,
	cwd,
	args,
	env,
	spawn,
	timeoutMs,
	killGraceMs,
}: {
	command: string;
	cwd: string;
	args: readonly string[];
	env: NodeJS.ProcessEnv;
	spawn: SpawnFn;
	timeoutMs: number;
	killGraceMs: number;
}): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const detached = process.platform !== 'win32';
		const child = spawn({ args, command, cwd, detached, env });
		const id = randomUUID();
		const killTimer = createKillTimer();
		let outcome: { data: unknown } | { error: Error } | undefined;
		let settled = false;
		let closeObserved = false;
		let outputBytes = 0;
		let closeTimer: NodeJS.Timeout | undefined;

		/**
		 * Gracefully signals only the direct child; force-kill may reach its group
		 * until close is observed. Close follows exit and waits for inherited pipes,
		 * so a wrapper can already be reaped while descendants still delay it. The
		 * pre-close group signal remains to bound that cleanup despite its numeric
		 * process-group identifier reuse tradeoff.
		 * A dying wrapper closes stdin, so also signalling its descendants would
		 * double-trigger their shutdown via SIGTERM and EOF.
		 * @param signal - Termination signal for this discovery process only.
		 */
		const signalChild = (signal: NodeJS.Signals): void => {
			signalQueryChild(
				child,
				detached && signal === 'SIGKILL' && !closeObserved,
				signal,
			);
		};

		/** Releases timers and pipes exactly once, preserving the first outcome. */
		const settle = (): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutTimer);
			clearTimeout(closeTimer);
			killTimer.clear();
			signalChild('SIGKILL');
			child.stdout.off('data', onStdout);
			child.stdout.off('end', onStdoutEnd);
			child.stderr.off('data', onStderr);
			child.stdin.destroy();
			child.stdout.destroy();
			child.stderr.destroy();
			lineStream.reset();
			if (outcome && 'data' in outcome) resolve(outcome.data);
			else
				reject(
					outcome?.error ??
						new Error('Pi RPC exited before get_commands responded.'),
				);
		};

		/**
		 * Records the first result and initiates shutdown with SIGTERM alone: Pi
		 * treats a concurrent stdin EOF as a second shutdown that aborts disposal.
		 * @param result - Payload or failure; subsequent frames cannot replace it.
		 */
		const finish = (result: NonNullable<typeof outcome>): void => {
			if (outcome || settled) return;
			outcome = result;
			clearTimeout(timeoutTimer);
			killTimer.schedule(killGraceMs, () => signalChild('SIGKILL'));
			closeTimer = setTimeout(settle, killGraceMs + CLOSE_GRACE_MS);
			signalChild('SIGTERM');
		};

		/**
		 * Converts transport or startup failures into a retryable query failure.
		 * @param message - Diagnostic describing why discovery could not complete.
		 */
		const fail = (message: string): void =>
			finish({ error: new Error(message) });

		/**
		 * Rejects blocking startup UI and validates the correlated response envelope.
		 * @param frame - Parsed RPC stdout record.
		 */
		const onFrame = (frame: unknown): void => {
			if (outcome || settled) return;
			if (!isRecord(frame) || typeof frame.type !== 'string') {
				fail('Malformed Pi RPC frame.');
				return;
			}
			if (frame.type === 'extension_ui_request') {
				if (
					typeof frame.method !== 'string' ||
					!PASSIVE_UI_METHODS.has(frame.method)
				) {
					fail('Pi RPC discovery requires user interaction.');
				}
				return;
			}
			if (frame.type === 'extension_error' || frame.type === 'agent_start') {
				fail('Pi RPC startup failed or attempted to start a model turn.');
				return;
			}
			if (frame.type !== 'response') return;
			if (frame.command === 'parse' && frame.success === false) {
				fail('Pi RPC rejected the get_commands request.');
				return;
			}
			if (frame.id !== id) return;
			if (
				frame.command !== 'get_commands' ||
				typeof frame.success !== 'boolean'
			) {
				fail('Malformed Pi RPC get_commands response.');
			} else if (!frame.success) {
				fail(
					typeof frame.error === 'string'
						? frame.error
						: 'Pi RPC get_commands failed.',
				);
			} else {
				finish({ data: frame.data });
			}
		};

		const lineStream = createPiRpcLineStream({
			/**
			 * Treats the adapter's recoverable parsing diagnostics as query failures.
			 * @param _code - Adapter error category, unused by catalogue discovery.
			 * @param message - Parsing failure diagnostic.
			 */
			emitError: (_code, message) => fail(message),
			maxLineBytes: MAX_LINE_BYTES,
			onFrame,
			/** Does not retain raw resource paths or extension startup output. */
			onRawLine: () => {},
		});
		const timeoutTimer = setTimeout(
			() => fail('Pi RPC get_commands timed out.'),
			timeoutMs,
		);

		/**
		 * Bounds total startup output, including a flood of short valid records.
		 * @param chunk - Bytes received on either output pipe.
		 * @returns Whether the chunk fits and the query still needs input.
		 */
		const acceptOutput = (chunk: Buffer): boolean => {
			if (outcome || settled) return false;
			outputBytes += chunk.length;
			if (outputBytes > MAX_OUTPUT_BYTES) {
				fail('Pi RPC discovery exceeded the output limit.');
				return false;
			}
			return true;
		};
		/**
		 * Feeds bounded stdout into the adapter's UTF-8 JSONL decoder.
		 * @param chunk - Bytes received on stdout.
		 */
		const onStdout = (chunk: Buffer): void => {
			if (acceptOutput(chunk)) lineStream.feed(chunk);
		};
		/** Flushes a final response before the child's close event classifies exit. */
		const onStdoutEnd = (): void => lineStream.flush();
		/**
		 * Counts stderr without retaining potentially sensitive startup output.
		 * @param chunk - Bytes received on stderr.
		 */
		const onStderr = (chunk: Buffer): void => {
			acceptOutput(chunk);
		};
		/** Fails on pipe errors while absorbing late EPIPE after termination. */
		const onError = (): void =>
			fail('Pi RPC discovery process or pipe failed.');
		child.stdout.on('data', onStdout);
		child.stdout.on('end', onStdoutEnd);
		child.stderr.on('data', onStderr);
		child.stdin.on('error', onError);
		child.stdout.on('error', onError);
		child.stderr.on('error', onError);
		child.on('error', onError);
		child.once('close', () => {
			closeObserved = true;
			settle();
		});
		try {
			child.stdin.write(`${JSON.stringify({ id, type: 'get_commands' })}\n`);
		} catch {
			onError();
		}
	});
}

/**
 * Signals the direct child or its isolated POSIX group, falling back to the child.
 * @param child - Child owned by the query.
 * @param includeProcessGroup - Whether to target the isolated group as well.
 * @param signal - Signal to deliver.
 */
function signalQueryChild(
	child: ChildLike,
	includeProcessGroup: boolean,
	signal: NodeJS.Signals,
): void {
	if (includeProcessGroup && child.pid) {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch {
			// ESRCH is expected when the wrapper has already exited; try its child.
		}
	}
	try {
		child.kill(signal);
	} catch {
		// Reaping can race either signal, so an already-gone child needs no retry.
	}
}

/**
 * Narrows an untrusted RPC value to a non-array record.
 * @param value - JSON value received from Pi.
 * @returns Whether named fields can be inspected safely.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
