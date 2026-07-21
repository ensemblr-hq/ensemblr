import { StringDecoder } from 'node:string_decoder';

/**
 * Chunked LF-delimited line buffer with a max-line-length guard. Designed for
 * RPC stdout: feed it chunks as they arrive; it emits complete lines and
 * reports an "oversize line" error if a single line outgrows the cap. The
 * trailing partial line stays buffered until the next chunk or `flush()`.
 *
 * Every chunk (Buffer, or a string via its UTF-8 bytes) is decoded through a
 * persistent {@link StringDecoder} so a multibyte UTF-8 sequence (emoji, CJK)
 * split across two chunk boundaries is held until its bytes complete instead of
 * decoding to U+FFFD on both sides.
 *
 * Pure utility — no I/O, no globals — so it is unit-tested in isolation.
 */

export interface JsonlLineStreamOptions {
	/** Max bytes per line. When exceeded, the line is dropped and onOversize fires. */
	maxLineBytes?: number;
	/** Called once per complete line (without the trailing LF). */
	onLine: (line: string) => void;
	/** Called when a single line exceeds `maxLineBytes`. The bad line is discarded. */
	onOversize?: (info: { droppedBytes: number; firstBytes: string }) => void;
}

const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;

/** Public surface of a chunked LF-delimited line buffer: feed chunks, flush, or reset. */
export interface JsonlLineStream {
	/** Push a chunk. Newlines may straddle chunk boundaries. */
	feed: (chunk: Buffer | string) => void;
	/** Flush whatever partial line is buffered as a final line. Idempotent. */
	flush: () => void;
	/** Drop the buffered partial line without emitting it. Used on abort. */
	reset: () => void;
}

/**
 * Builds a {@link JsonlLineStream}. Lines are produced in the order the LF
 * bytes arrive, so downstream ordering matches the producer's wire order.
 *
 * Behavior contract:
 *  - `\r\n` and `\n` both terminate a line; the line text excludes the EOL.
 *  - Empty lines are passed through as `''` — the caller decides whether to skip.
 *  - When the buffered partial exceeds `maxLineBytes`, the buffer is discarded
 *    and `onOversize` fires. Subsequent bytes start a fresh line.
 */
export function createJsonlLineStream({
	maxLineBytes = DEFAULT_MAX_LINE_BYTES,
	onLine,
	onOversize,
}: JsonlLineStreamOptions): JsonlLineStream {
	let buffer = '';
	let oversizeActive = false;
	let decoder = new StringDecoder('utf8');

	const flushBufferedLine = (): void => {
		if (oversizeActive) {
			// Reached the cap before LF; drop everything until we see the next LF.
			oversizeActive = false;
			buffer = '';
			return;
		}
		if (buffer.length === 0) {
			return;
		}
		const line = stripTrailingCarriageReturn(buffer);
		buffer = '';
		onLine(line);
	};

	const tripOversize = (): void => {
		if (oversizeActive) {
			return;
		}
		oversizeActive = true;
		const droppedBytes = Buffer.byteLength(buffer, 'utf8');
		const firstBytes = buffer.slice(0, Math.min(128, buffer.length));
		buffer = '';
		onOversize?.({ droppedBytes, firstBytes });
	};

	const ingest = (text: string): void => {
		if (text.length === 0) {
			return;
		}

		let start = 0;
		for (let index = 0; index < text.length; index += 1) {
			if (text.charCodeAt(index) !== 0x0a) {
				continue;
			}
			const slice = text.slice(start, index);
			start = index + 1;

			if (oversizeActive) {
				// Discard remainder of the oversized line up to and including LF.
				oversizeActive = false;
				buffer = '';
				continue;
			}

			const combined = buffer + slice;
			buffer = '';
			if (Buffer.byteLength(combined, 'utf8') > maxLineBytes) {
				onOversize?.({
					droppedBytes: Buffer.byteLength(combined, 'utf8'),
					firstBytes: combined.slice(0, Math.min(128, combined.length)),
				});
				continue;
			}
			onLine(stripTrailingCarriageReturn(combined));
		}

		if (start < text.length) {
			if (oversizeActive) {
				// Already tripped; keep dropping until the next LF.
				return;
			}
			const remainder = text.slice(start);
			const projectedBytes = Buffer.byteLength(buffer + remainder, 'utf8');
			if (projectedBytes > maxLineBytes) {
				buffer += remainder;
				tripOversize();
				return;
			}
			buffer += remainder;
		}
	};

	return {
		feed: (chunk) => {
			// Route string chunks through the decoder too (via their UTF-8 bytes) so
			// a partial multibyte left pending by a prior Buffer feed is completed
			// rather than stranded when feed types are mixed.
			ingest(
				decoder.write(
					typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk,
				),
			);
		},
		flush: () => {
			const tail = decoder.end();
			if (tail.length > 0) {
				ingest(tail);
			}
			flushBufferedLine();
		},
		reset: () => {
			buffer = '';
			oversizeActive = false;
			decoder = new StringDecoder('utf8');
		},
	};
}

/**
 * Drops a single trailing carriage return so `\r\n` lines yield the same text as `\n` lines.
 * @param line - Line text, possibly ending in CR
 * @returns The line without its trailing CR
 */
function stripTrailingCarriageReturn(line: string): string {
	if (line.length > 0 && line.charCodeAt(line.length - 1) === 0x0d) {
		return line.slice(0, -1);
	}
	return line;
}
