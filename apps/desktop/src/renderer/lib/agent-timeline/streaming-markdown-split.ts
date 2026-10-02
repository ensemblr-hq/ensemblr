/** A fenced-code delimiter opening or closing at column zero. */
const COLUMN_ZERO_FENCE = /^(?:`{3,}|~{3,})/;

/** An answer split into the part that can no longer change and the part still arriving. */
export interface StreamingMarkdownSplit {
	settled: string;
	tail: string;
}

/**
 * Whether a fence delimiter closes the fence `open` opened, by the CommonMark
 * rule that a closing delimiter uses the same character and is at least as long.
 * @param open - The opening delimiter run
 * @param candidate - The delimiter run being weighed as its close
 * @returns True when the candidate closes the fence
 */
function closesFence(open: string, candidate: string): boolean {
	return candidate[0] === open[0] && candidate.length >= open.length;
}

/**
 * Splits a streaming answer at the last point a fenced code block closed, so the
 * part above it can be handed to a memoized renderer that never sees it change.
 *
 * A streaming markdown renderer memoizes the *blocks* it has already drawn, but
 * it must still re-lex the whole string on every delta to find where the blocks
 * are — so the cost of one token is linear in the answer so far, and the answer
 * only grows. Splitting caps that walk at the length of the tail.
 *
 * The boundary is deliberately narrow. A blank line is not enough: a list, a
 * blockquote and a table all survive one, so `1. a\n\n2. b` split at the blank
 * line renders the second item as `1.` again. A fence that opened and closed at
 * column zero cannot be inside any of those containers — a fence nested in one is
 * indented to its content column — so the text above it is a complete run of
 * blocks whatever follows. A closing delimiter also has to be followed by a blank
 * line, so the tail starts on a block boundary rather than on a lazy
 * continuation of the paragraph after the fence.
 *
 * Link reference definitions are the one construct this cannot honour: one
 * written after the split cannot resolve a `[ref]` written before it. That is the
 * price of the split, and agents do not write them.
 * @param text - The answer as it stands, including the token that just arrived
 * @returns The settled leading blocks and the tail still being written
 */
export function splitSettledMarkdown(text: string): StreamingMarkdownSplit {
	const lines = text.split('\n');
	let openFence: string | null = null;
	let boundary = -1;
	let offset = 0;

	for (const [index, line] of lines.entries()) {
		const lineStart = offset;
		offset += line.length + 1;
		const delimiter = COLUMN_ZERO_FENCE.exec(line)?.[0];
		if (!delimiter) {
			continue;
		}
		if (openFence === null) {
			openFence = delimiter;
			continue;
		}
		if (!closesFence(openFence, delimiter)) {
			continue;
		}
		openFence = null;
		if (lines[index + 1] === '') {
			boundary = lineStart + line.length + 1;
		}
	}

	if (boundary <= 0 || boundary >= text.length) {
		return { settled: '', tail: text };
	}
	return { settled: text.slice(0, boundary), tail: text.slice(boundary) };
}
