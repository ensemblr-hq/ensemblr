/**
 * Fixed-byte ring buffer used to capture stderr from the Pi RPC child so that
 * the most recent output is available when the process exits abnormally.
 *
 * Internal to the CLI RPC adapter — not exported from `pi-agent/index.ts`.
 */
export interface RingBuffer {
	snapshot: () => string;
	write: (chunk: Buffer) => void;
}

export function createRingBuffer(maxBytes: number): RingBuffer {
	let stored = Buffer.alloc(0);
	return {
		snapshot: () => stored.toString('utf8'),
		write: (chunk: Buffer) => {
			if (chunk.length === 0) {
				return;
			}
			const combined = Buffer.concat([stored, chunk]);
			stored =
				combined.length > maxBytes
					? combined.subarray(combined.length - maxBytes)
					: combined;
		},
	};
}
