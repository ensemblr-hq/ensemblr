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

/**
 * How far the retained chunks may exceed `maxBytes` before they are joined and
 * trimmed. Concatenating on every write made a chunk cost a copy of the whole
 * buffer, so a child that logs progress to stderr paid `maxBytes` per line;
 * letting the excess build first makes each write amortized O(chunk).
 */
const COMPACTION_FACTOR = 2;

/**
 * Create a fixed-byte ring buffer that retains only the most recent bytes.
 * @param maxBytes - Maximum number of bytes to retain.
 * @returns A ring buffer exposing `write` and `snapshot`.
 */
export function createRingBuffer(maxBytes: number): RingBuffer {
	let parts: Buffer[] = [];
	let retained = 0;

	const compact = (): Buffer => {
		const combined = Buffer.concat(parts, retained);
		const trimmed =
			combined.length > maxBytes
				? combined.subarray(combined.length - maxBytes)
				: combined;
		parts = [trimmed];
		retained = trimmed.length;
		return trimmed;
	};

	return {
		snapshot: () => compact().toString('utf8'),
		write: (chunk: Buffer) => {
			if (chunk.length === 0) {
				return;
			}
			parts.push(chunk);
			retained += chunk.length;
			if (retained > maxBytes * COMPACTION_FACTOR) {
				compact();
			}
		},
	};
}
