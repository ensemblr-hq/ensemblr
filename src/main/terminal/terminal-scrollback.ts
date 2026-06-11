/**
 * Bounded in-memory scrollback for terminal sessions. Keeps the most recent
 * output so a renderer that (re)attaches can replay state without persisting
 * long raw buffers to SQLite.
 */

/** Default maximum retained scrollback per session, in UTF-16 code units. */
export const DEFAULT_SCROLLBACK_LIMIT = 400_000;

/** Mutable bounded scrollback buffer. */
export interface ScrollbackBuffer {
	append: (chunk: string) => void;
	read: () => string;
}

/**
 * Creates a bounded scrollback buffer that trims from the front once `limit`
 * is exceeded.
 * @param limit - Maximum retained length.
 * @returns A fresh {@link ScrollbackBuffer}.
 */
export function createScrollbackBuffer(
	limit = DEFAULT_SCROLLBACK_LIMIT,
): ScrollbackBuffer {
	let chunks: string[] = [];
	let totalLength = 0;

	return {
		append: (chunk) => {
			if (!chunk) {
				return;
			}

			chunks.push(chunk);
			totalLength += chunk.length;

			while (totalLength > limit && chunks.length > 0) {
				const overflow = totalLength - limit;
				const head = chunks[0] as string;

				if (head.length <= overflow) {
					chunks = chunks.slice(1);
					totalLength -= head.length;
				} else {
					chunks = [head.slice(overflow), ...chunks.slice(1)];
					totalLength -= overflow;
				}
			}
		},
		read: () => chunks.join(''),
	};
}
