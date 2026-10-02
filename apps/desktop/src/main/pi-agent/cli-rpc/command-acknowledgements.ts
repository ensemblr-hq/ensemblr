import { AgentSubmitError } from '../../agent-runtime/agent-types.ts';

/** Bounds authentication, compaction and extension preflight, not model execution. */
const ACCEPTANCE_TIMEOUT_MS = 180_000;

/** Correlates command acceptance separately from the lifetime of a model turn. */
export function createCommandAcknowledgements() {
	const pending = new Map<
		string,
		{ command: string; settle: (error?: Error) => void }
	>();

	return {
		/**
		 * Writes a command and waits for its matching acceptance, not just a pipe write.
		 * @param frame - Command carrying a unique RPC correlation id.
		 * @param writeFrame - The session's checked JSONL writer.
		 * @param timeoutMs - Deadline for this command's phase, never renewed by unrelated events.
		 * @returns Completion when Pi accepts; rejection on refusal, timeout, or exit.
		 */
		send(
			frame: { id: string; type: string; [key: string]: unknown },
			writeFrame: (frame: unknown) => Promise<void>,
			timeoutMs = ACCEPTANCE_TIMEOUT_MS,
		): Promise<void> {
			return new Promise<void>((resolve, reject) => {
				/**
				 * Releases the request and its deadline exactly once.
				 * @param error - Failure to propagate instead of acceptance.
				 */
				const settle = (error?: Error): void => {
					if (!pending.delete(frame.id)) {
						return;
					}
					clearTimeout(timer);
					if (error) {
						reject(
							error instanceof AgentSubmitError
								? error
								: new AgentSubmitError(error.message, 'unconfirmed'),
						);
					} else {
						resolve();
					}
				};
				const timer = setTimeout(() => {
					settle(new Error(`Pi RPC ${frame.type} acceptance timed out.`));
				}, timeoutMs);
				timer.unref();
				pending.set(frame.id, { command: frame.type, settle });
				void writeFrame(frame).catch((cause: unknown) => {
					settle(cause instanceof Error ? cause : new Error(String(cause)));
				});
			});
		},
		/**
		 * Consumes only responses belonging to a tracked command.
		 * @param frame - Parsed Pi JSONL frame.
		 * @returns Whether the frame settled a pending command.
		 */
		handleResponse(frame: unknown): boolean {
			if (!frame || typeof frame !== 'object') {
				return false;
			}
			const response = frame as Record<string, unknown>;
			if (
				response.type !== 'response' ||
				typeof response.id !== 'string' ||
				typeof response.success !== 'boolean'
			) {
				return false;
			}
			const request = pending.get(response.id);
			if (!request || request.command !== response.command) {
				return false;
			}
			request.settle(
				response.success === true
					? undefined
					: new AgentSubmitError(
							typeof response.error === 'string'
								? response.error
								: 'Pi RPC command rejected.',
							'rejected',
						),
			);
			return true;
		},
		/**
		 * Releases all callers when their runtime can no longer acknowledge commands.
		 * @param error - Shutdown or cancellation reason.
		 */
		rejectAll(error: Error): void {
			for (const request of pending.values()) {
				request.settle(error);
			}
		},
	};
}
