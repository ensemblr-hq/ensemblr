import { i18n } from '@/renderer/lib/i18n';
import type { ToolDiffRow } from '@/renderer/types/diff';
import { newLineNumberOf, oldLineNumberOf, parseSingleFileDiff } from './parse';

/**
 * Flattens a single-file patch into render-ready rows plus one source string
 * per hunk.
 *
 * Hunks are kept apart because a patch omits the unchanged lines between them:
 * joining them would leave constructs such as a block comment unterminated and
 * bleed that state into every later line. `parseSingleFileDiff` already strips
 * the `+`/`-`/space marker from each change, so the text goes to Shiki verbatim.
 * @param patch - Unified diff for a single file
 * @returns The rows to render, and the per-hunk sources backing their tokens
 */
export function buildToolDiffRows(patch: string): {
	rows: ToolDiffRow[];
	sources: string[];
} {
	const file = parseSingleFileDiff(patch);
	const rows: ToolDiffRow[] = [];
	const sources: string[] = [];
	let previousOldEnd: number | null = null;

	for (const [hunkIndex, hunk] of (file?.hunks ?? []).entries()) {
		if (previousOldEnd !== null) {
			rows.push({
				key: `gap-${hunk.oldStart}`,
				kind: 'gap',
				label: describeGap(hunk.oldStart - previousOldEnd),
			});
		}
		const lines: string[] = [];
		for (const change of hunk.changes) {
			rows.push({
				hunkIndex,
				key: `hunk-${hunkIndex}-line-${lines.length}`,
				kind: change.type,
				lineIndex: lines.length,
				newLine: newLineNumberOf(change),
				oldLine: oldLineNumberOf(change),
				text: change.content,
			});
			lines.push(change.content);
		}
		sources.push(lines.join('\n'));
		previousOldEnd = hunk.oldStart + hunk.oldLines;
	}

	return { rows, sources };
}

/**
 * Labels the band standing in for lines a patch skipped between two hunks.
 * @param hidden - Number of unchanged lines between the hunks
 * @returns The band's label
 */
function describeGap(hidden: number): string {
	if (hidden <= 0) {
		return i18n.t('review:diff-viewer.unchanged-lines', 'Unchanged lines');
	}
	return i18n.t('review:diff-viewer.hidden-line-count', {
		count: hidden,
		defaultValue_one: '{{count}} unchanged line',
		defaultValue_other: '{{count}} unchanged lines',
	});
}
