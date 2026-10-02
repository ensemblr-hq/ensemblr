import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/** A long-lived input stream plus the handles to feed and end it. */
export interface PromptQueue {
	/** Ends the stream, which lets the SDK's `query()` generator finish. */
	close: () => void;
	/**
	 * Releases a held queue to the runtime. A queue built with `held` reads
	 * nothing until this is called; calling it on an unheld queue does nothing.
	 */
	open: () => void;
	/** Enqueues one user turn, waking the stream if it is parked. */
	push: (message: SDKUserMessage) => void;
	/** The async iterable handed to `query({ prompt })`. */
	stream: AsyncIterable<SDKUserMessage>;
}

/**
 * Builds the async iterable that drives streaming-input mode.
 *
 * Streaming input is not optional: `interrupt()`, `setModel()`, and
 * `setPermissionMode()` only exist when `prompt` is an
 * `AsyncIterable<SDKUserMessage>`. The queue therefore stays open for the life
 * of the session, parking on a promise between turns rather than ending — a
 * generator that returned after the first prompt would tear the session down.
 * @param options - Pass `held` to park the stream until {@link PromptQueue.open}
 *   is called, so a caller with session setup to finish can land it before the
 *   runtime reads a first turn. Gating the stream rather than the caller's own
 *   submit path is what keeps two overlapping submits in the order the
 *   transcript recorded them.
 * @returns A {@link PromptQueue}.
 */
export function createPromptQueue(
	options: { held?: boolean } = {},
): PromptQueue {
	const pending: SDKUserMessage[] = [];
	let notify: (() => void) | null = null;
	let done = false;
	let release: (() => void) | null = null;
	const opened = options.held
		? new Promise<void>((resolve) => {
				release = resolve;
			})
		: Promise.resolve();

	const wake = (): void => {
		const resume = notify;
		notify = null;
		resume?.();
	};

	const open = (): void => {
		const resume = release;
		release = null;
		resume?.();
	};

	async function* stream(): AsyncGenerator<SDKUserMessage, void> {
		await opened;
		while (!done) {
			const next = pending.shift();
			if (next) {
				yield next;
				continue;
			}
			await new Promise<void>((resolve) => {
				notify = resolve;
			});
		}
		// Drain anything queued in the same tick as `close()` so a final turn is
		// never silently dropped.
		while (pending.length > 0) {
			const next = pending.shift();
			if (next) {
				yield next;
			}
		}
	}

	return {
		close: () => {
			done = true;
			open();
			wake();
		},
		open,
		push: (message) => {
			if (done) {
				return;
			}
			pending.push(message);
			wake();
		},
		stream: stream(),
	};
}
