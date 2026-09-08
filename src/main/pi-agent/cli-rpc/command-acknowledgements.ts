const ACCEPTANCE_TIMEOUT_MS = 10_000;

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
		 * @returns Completion when Pi accepts; rejection on refusal, timeout, or exit.
		 */
		send(
			frame: { id: string; type: string; [key: string]: unknown },
			writeFrame: (frame: unknown) => Promise<void>,
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
						reject(error);
					} else {
						resolve();
					}
				};
				const timer = setTimeout(() => {
					settle(
						new Error(
							`Pi RPC ${frame.type} acceptance timed out; delivery is unconfirmed.`,
						),
					);
				}, ACCEPTANCE_TIMEOUT_MS);
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
			if (response.type !== 'response' || typeof response.id !== 'string') {
				return false;
			}
			const request = pending.get(response.id);
			if (!request || request.command !== response.command) {
				return false;
			}
			request.settle(
				response.success === true
					? undefined
					: new Error(
							typeof response.error === 'string'
								? response.error
								: 'Pi RPC command rejected.',
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
