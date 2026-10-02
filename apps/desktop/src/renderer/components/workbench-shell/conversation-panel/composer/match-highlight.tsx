import type { ReactNode } from 'react';
import type { MatchRange } from '@/renderer/lib/workbench/fuzzy-score';

/** One run of text the highlight renders, either matched or not. */
interface HighlightSegment {
	end: number;
	matched: boolean;
	start: number;
}

/**
 * Splits text into alternating matched and unmatched runs, clamping ranges into
 * the string and skipping empty or inverted ones so a stale pairing of text and
 * ranges degrades to plain text instead of throwing.
 * @param text - The full string being rendered.
 * @param ranges - Ascending, disjoint spans that matched the query.
 * @returns The runs to render, covering the whole string in order.
 */
function buildSegments(
	text: string,
	ranges: readonly MatchRange[],
): HighlightSegment[] {
	const segments: HighlightSegment[] = [];
	let cursor = 0;
	for (const range of ranges) {
		const start = Math.max(cursor, Math.min(range.start, text.length));
		const end = Math.max(start, Math.min(range.end, text.length));
		if (end <= start) {
			continue;
		}
		if (start > cursor) {
			segments.push({ end: start, matched: false, start: cursor });
		}
		segments.push({ end, matched: true, start });
		cursor = end;
	}
	if (cursor < text.length) {
		segments.push({ end: text.length, matched: false, start: cursor });
	}
	return segments;
}

/**
 * Renders text with the characters a query matched left at full strength and the
 * rest dimmed, so the menu shows why a row is in the list.
 *
 * With nothing matched — which is the state the menu opens in, before anything
 * is typed — the text renders plainly rather than uniformly dimmed.
 */
export function MatchHighlight({
	ranges,
	text,
}: {
	ranges: readonly MatchRange[];
	text: string;
}): ReactNode {
	const segments = buildSegments(text, ranges);
	if (!segments.some((segment) => segment.matched)) {
		return text;
	}

	return segments.map((segment) => (
		<span
			className={segment.matched ? undefined : 'text-muted-foreground'}
			key={`${segment.start}-${segment.end}`}
		>
			{text.slice(segment.start, segment.end)}
		</span>
	));
}
