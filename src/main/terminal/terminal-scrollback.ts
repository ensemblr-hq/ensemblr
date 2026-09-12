/**
 * Bounded in-memory scrollback for terminal sessions. Keeps the most recent
 * output so a renderer that (re)attaches can replay state without persisting
 * long raw buffers to SQLite.
 */

/** Default maximum retained scrollback per session, in UTF-16 code units. */
export const DEFAULT_SCROLLBACK_LIMIT = 400_000;

/**
 * Where the retained window sits in the session's whole output stream, counted
 * in characters ever appended. `read()` returns exactly `[dropped, appended)`,
 * so a flusher can tell whether the bytes it wrote last time are still a prefix
 * of what the buffer holds now.
 */
export interface ScrollbackOffsets {
	appended: number;
	dropped: number;
}

/** Mutable bounded scrollback buffer. */
export interface ScrollbackBuffer {
	append: (chunk: string) => void;
	offsets: () => ScrollbackOffsets;
	read: () => string;
	readSince: (mark: number) => string | null;
}

/**
 * Ratio of dead head entries to live ones that triggers a compaction. Trimming
 * advances a head index rather than rebuilding the array, so the dead prefix is
 * reclaimed only when it has grown to half the array — which makes each append
 * amortized O(1) instead of O(retained chunks).
 */
const COMPACTION_RATIO = 2;

/**
 * Creates a bounded scrollback buffer that trims from the front once `limit`
 * is exceeded.
 * @param limit - Maximum retained length.
 * @returns A fresh {@link ScrollbackBuffer}.
 */
export function createScrollbackBuffer(
	limit = DEFAULT_SCROLLBACK_LIMIT,
): ScrollbackBuffer {
	const chunks: string[] = [];
	let start = 0;
	let totalLength = 0;
	let appendedTotal = 0;

	const compactIfSparse = (): void => {
		if (start > 0 && start * COMPACTION_RATIO >= chunks.length) {
			chunks.splice(0, start);
			start = 0;
		}
	};

	return {
		append: (chunk) => {
			if (!chunk) {
				return;
			}

			chunks.push(chunk);
			totalLength += chunk.length;
			appendedTotal += chunk.length;

			while (totalLength > limit && start < chunks.length) {
				const overflow = totalLength - limit;
				const head = chunks[start] as string;

				if (head.length <= overflow) {
					start += 1;
					totalLength -= head.length;
				} else {
					chunks[start] = head.slice(overflow);
					totalLength -= overflow;
				}
			}

			compactIfSparse();
		},
		offsets: () => ({
			appended: appendedTotal,
			dropped: appendedTotal - totalLength,
		}),
		read: () => chunks.slice(start).join(''),
		readSince: (mark) => {
			const dropped = appendedTotal - totalLength;
			if (mark < dropped) {
				return null;
			}
			if (mark >= appendedTotal) {
				return '';
			}

			const parts: string[] = [];
			let skip = mark - dropped;
			for (let index = start; index < chunks.length; index += 1) {
				const chunk = chunks[index] as string;
				if (skip >= chunk.length) {
					skip -= chunk.length;
					continue;
				}
				parts.push(skip > 0 ? chunk.slice(skip) : chunk);
				skip = 0;
			}

			return parts.join('');
		},
	};
}
