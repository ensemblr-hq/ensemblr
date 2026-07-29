import { useMemo } from 'react';
import type { BundledLanguage } from 'shiki';
import {
	CodeLineTokens,
	CodeSurface,
} from '@/renderer/components/code-surface';
import { useHighlightedHunks } from '@/renderer/hooks/code-surface/use-highlighted-code';
import { buildToolDiffRows } from '@/renderer/lib/diff/tool-rows';
import { cn } from '@/renderer/lib/utils';
import type { TokenizedCode } from '@/renderer/types/code';
import type { ToolDiffRow } from '@/renderer/types/diff';

const DIFF_ROW_BACKGROUND = {
	delete: 'bg-status-danger/15',
	insert: 'bg-status-ok/15',
	normal: '',
} as const;

const DIFF_ROW_MARKER = { delete: '-', insert: '+', normal: ' ' } as const;

/** Narrowest gutter that still fits the widest line number, plus breathing room. */
const MIN_GUTTER_DIGITS = 2;

/**
 * Body for a file edit: a read-only diff with gutters, change tints, and a
 * skipped-lines band. Feed it a unified diff for one file.
 *
 * Purpose-built rather than reusing the app's `DiffViewer`, which brings a
 * toolbar, view-mode switching, and inline commenting — all noise inside a chat
 * row. It reads the same `parseSingleFileDiff` the real viewer does, so hunk
 * parsing cannot drift between the two.
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
	const gutterWidth = useMemo(() => `${gutterDigits(rows)}ch`, [rows]);

	return (
		<CodeSurface>
			{rows.map((row) =>
				row.kind === 'gap' ? (
					<div
						className='select-none border-code-border border-y bg-code-foreground/5 px-3 py-0.5 opacity-60'
						key={row.key}
					>
						{row.label}
					</div>
				) : (
					<ToolDiffLine
						gutterWidth={gutterWidth}
						key={row.key}
						row={row}
						tokens={tokensByHunk[row.hunkIndex]?.tokens[row.lineIndex] ?? null}
					/>
				),
			)}
		</CodeSurface>
	);
}

/**
 * Measures the gutter against the highest line number either side reaches.
 * @param rows - The rows about to be rendered
 * @returns The gutter width in characters
 */
function gutterDigits(rows: readonly ToolDiffRow[]): number {
	const widest = rows.reduce(
		(max, row) =>
			row.kind === 'gap'
				? max
				: Math.max(max, row.newLine ?? 0, row.oldLine ?? 0),
		0,
	);
	return Math.max(MIN_GUTTER_DIGITS, String(widest).length) + 1;
}

/** One diff line: old and new gutters, the change marker, then highlighted content. */
function ToolDiffLine({
	gutterWidth,
	row,
	tokens,
}: {
	gutterWidth: string;
	row: Extract<ToolDiffRow, { kind: 'delete' | 'insert' | 'normal' }>;
	tokens: TokenizedCode['tokens'][number] | null;
}) {
	return (
		<div className={cn('flex', DIFF_ROW_BACKGROUND[row.kind])}>
			<span
				className='box-content shrink-0 select-none pr-2 pl-3 text-right tabular-nums opacity-40'
				style={{ width: gutterWidth }}
			>
				{row.oldLine ?? ''}
			</span>
			<span
				className='box-content shrink-0 select-none pr-2 text-right tabular-nums opacity-40'
				style={{ width: gutterWidth }}
			>
				{row.newLine ?? ''}
			</span>
			<span className='shrink-0 select-none pr-2 opacity-50'>
				{DIFF_ROW_MARKER[row.kind]}
			</span>
			<span className='whitespace-pre pr-4'>
				<CodeLineTokens fallback={row.text} lineKey={row.key} tokens={tokens} />
			</span>
		</div>
	);
}
