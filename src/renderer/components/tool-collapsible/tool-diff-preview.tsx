import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BundledLanguage } from 'shiki';
import {
	CODE_CONTENT_CLASSES,
	CodeGutter,
	CodeHunkGap,
	CodeLineTokens,
	CodePanel,
	CodeSurface,
	DIFF_GUTTER_TINT,
	DIFF_ROW_SURFACE,
} from '@/renderer/components/code-surface';
import { useHighlightedHunks } from '@/renderer/hooks/code-surface/use-highlighted-code';
import { splitCombinedPatch } from '@/renderer/lib/diff/parse';
import { buildToolDiffRows } from '@/renderer/lib/diff/tool-rows';
import { languageForFilePath } from '@/renderer/lib/language-from-path';
import { cn } from '@/renderer/lib/utils';
import type { TokenizedCode } from '@/renderer/types/code';
import type { ToolDiffRow } from '@/renderer/types/diff';

/**
 * Body for file edits and workspace reads: a read-only unified diff with
 * gutters, change tints, skipped-lines bands, and optional per-file headings.
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
	showFileNames = false,
}: {
	language: BundledLanguage;
	patch: string;
	showFileNames?: boolean;
}) {
	const patches = useMemo(() => splitCombinedPatch(patch), [patch]);
	if (patches.length === 0) {
		return patch.trim() ? (
			<ToolDiffFile language={language} patch={patch} />
		) : null;
	}
	if (patches.length === 1) {
		const file = patches[0];
		return showFileNames ? (
			<div className='space-y-2'>
				<div className='px-1 font-mono text-muted-foreground text-xs'>
					{file.path}
				</div>
				<ToolDiffFile
					language={languageForFilePath(file.path)}
					patch={file.patch}
				/>
			</div>
		) : (
			<ToolDiffFile language={language} patch={file.patch} />
		);
	}
	return (
		<div className='space-y-4'>
			{patches.map((file) => (
				<div className='space-y-2' key={file.path}>
					<div className='px-1 font-mono text-muted-foreground text-xs'>
						{file.path}
					</div>
					<ToolDiffFile
						language={languageForFilePath(file.path)}
						patch={file.patch}
					/>
				</div>
			))}
		</div>
	);
}

/** Renders one file from a combined tool patch with independently parsed hunks. */
function ToolDiffFile({
	language,
	patch,
}: {
	language: BundledLanguage;
	patch: string;
}) {
	const { i18n } = useTranslation();
	// biome-ignore lint/correctness/useExhaustiveDependencies: the skipped-lines band is translated through the i18n singleton, so the language is a real input Biome cannot see.
	const { rows, sources } = useMemo(
		() => buildToolDiffRows(patch),
		[patch, i18n.language],
	);
	const tokensByHunk = useHighlightedHunks(sources, language);
	const maxLineNumber = useMemo(() => highestLineNumber(rows), [rows]);
	const notice = trailingNotice(patch);

	if (rows.length === 0) {
		return <CodePanel code={patch} language={language} startLine={null} />;
	}

	return (
		<div className='space-y-2'>
			<CodeSurface>
				{rows.map((row) =>
					row.kind === 'gap' ? (
						<CodeHunkGap key={row.key} label={row.label} />
					) : (
						<ToolDiffLine
							key={row.key}
							maxLineNumber={maxLineNumber}
							row={row}
							tokens={
								tokensByHunk[row.hunkIndex]?.tokens[row.lineIndex] ?? null
							}
						/>
					),
				)}
			</CodeSurface>
			{notice === null ? null : (
				<CodePanel code={notice} language={language} startLine={null} />
			)}
		</div>
	);
}

/**
 * Reads the prose recovery pointer appended after a valid unified diff.
 * @param patch - Patch that may end in a truncation pointer
 * @returns The pointer text, or null when the patch ends with diff content
 */
function trailingNotice(patch: string): string | null {
	const separator = patch.lastIndexOf('\n\n');
	if (separator < 0) {
		return null;
	}
	const tail = patch.slice(separator + 2).trim();
	return tail.startsWith('… ') ? tail : null;
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
