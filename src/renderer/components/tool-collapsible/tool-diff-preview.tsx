import { useMemo } from 'react';
import type { BundledLanguage } from 'shiki';
import {
	CODE_CONTENT_CLASSES,
	CodeGutter,
	CodeHunkGap,
	CodeLineTokens,
	CodeSurface,
	DIFF_GUTTER_TINT,
	DIFF_ROW_SURFACE,
} from '@/renderer/components/code-surface';
import { useHighlightedHunks } from '@/renderer/hooks/code-surface/use-highlighted-code';
import { buildToolDiffRows } from '@/renderer/lib/diff/tool-rows';
import { cn } from '@/renderer/lib/utils';
import type { TokenizedCode } from '@/renderer/types/code';
import type { ToolDiffRow } from '@/renderer/types/diff';

/**
 * Body for a file edit: a read-only diff with gutters, change tints, and a
 * skipped-lines band. Feed it a unified diff for one file.
 *
 * Purpose-built rather than reusing the app's `DiffViewer`, which brings a
 * toolbar, view-mode switching, and inline commenting — all noise inside a chat
 * row. It reads the same `parseSingleFileDiff` the real viewer does and paints
 * from the same gutter, tint, and skipped-lines recipes, so neither the hunk
 * parsing nor the look can drift between the two.
 */
export function ToolDiffPreview({
	language,
	patch,
}: {
	language: BundledLanguage;
	patch: string;
}) {
	const { rows, sources } = useMemo(() => buildToolDiffRows(patch), [patch]);
	const tokensByHunk = useHighlightedHunks(sources, language);
	const maxLineNumber = useMemo(() => highestLineNumber(rows), [rows]);

	return (
		<CodeSurface>
			{rows.map((row) =>
				row.kind === 'gap' ? (
					<CodeHunkGap key={row.key} label={row.label} />
				) : (
					<ToolDiffLine
						key={row.key}
						maxLineNumber={maxLineNumber}
						row={row}
						tokens={tokensByHunk[row.hunkIndex]?.tokens[row.lineIndex] ?? null}
					/>
				),
			)}
		</CodeSurface>
	);
}

/**
 * Highest line number either side of the diff reaches, which sizes both gutters.
 * @param rows - The rows about to be rendered
 * @returns The largest line number in the diff
 */
function highestLineNumber(rows: readonly ToolDiffRow[]): number {
	return rows.reduce(
		(max, row) =>
			row.kind === 'gap'
				? max
				: Math.max(max, row.newLine ?? 0, row.oldLine ?? 0),
		0,
	);
}

/**
 * One diff line: the old and new line-number gutters, then highlighted content.
 * The change reads from the row's tint and its tinted gutter cell — the same
 * cues the full diff viewer uses, and the ones the colorblind modes re-hue.
 */
function ToolDiffLine({
	maxLineNumber,
	row,
	tokens,
}: {
	maxLineNumber: number;
	row: Extract<ToolDiffRow, { kind: 'delete' | 'insert' | 'normal' }>;
	tokens: TokenizedCode['tokens'][number] | null;
}) {
	const tint = DIFF_GUTTER_TINT[row.kind];
	return (
		<div className={cn('flex', DIFF_ROW_SURFACE[row.kind])}>
			<CodeGutter
				maxLineNumber={maxLineNumber}
				tint={tint}
				value={row.oldLine ?? ''}
			/>
			<CodeGutter
				divider
				maxLineNumber={maxLineNumber}
				tint={tint}
				value={row.newLine ?? ''}
			/>
			<span className={CODE_CONTENT_CLASSES}>
				<CodeLineTokens fallback={row.text} lineKey={row.key} tokens={tokens} />
			</span>
		</div>
	);
}
