import { useAtomValue } from 'jotai';
import { PlusIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import {
	type ChangeData,
	Decoration,
	Diff,
	expandFromRawCode,
	getChangeKey,
	Hunk,
	type HunkData,
} from 'react-diff-view';
import 'react-diff-view/style/index.css';
import type { BundledLanguage } from 'shiki';

import { CodeBlockContent } from '@/renderer/components/code-block';
import {
	CODE_PANEL_TEXT_CLASSES,
	CODE_SURFACE_CLASSES,
	CodeHunkGap,
	CodeViewerHeader,
} from '@/renderer/components/code-surface';
import { codeGutterDigits } from '@/renderer/lib/code';
import {
	newLineNumberOf,
	oldLineNumberOf,
	parseSingleFileDiff,
	reconstructOldSource,
} from '@/renderer/lib/diff/parse';
import { languageForFilePath } from '@/renderer/lib/language-from-path';
import { cn } from '@/renderer/lib/utils';
import {
	diffLayoutAtom,
	diffShowWhitespaceAtom,
	diffWordWrapAtom,
} from '@/renderer/state/preferences';
import type { DiffComment, DiffViewMode } from '@/renderer/types/diff';
import { DiffCommentThread } from './diff-comment-thread';
import { DiffToolbar } from './diff-toolbar';
import { renderDiffToken, useDiffTokens } from './shiki-tokenize';

const EMPTY_HUNKS: HunkData[] = [];

/** Details of the line a new comment is being added to. */
interface AddCommentInput {
	body: string;
	changeKey: string;
	lineNumber: number | null;
}

/**
 * Rich single-file diff viewer: parsed hunks with line-number gutters, Shiki
 * syntax colors, click-a-line inline comments (local editable + GitHub/bot
 * read-only), toggles for full-file view, split layout, hidden characters, and
 * word wrap, plus a Viewed marker wherever the caller tracks review progress.
 * Falls back to a plain highlighted patch when the diff cannot be parsed.
 */
export function DiffViewer({
	commentsByChangeKey,
	fillHeight = true,
	filePath,
	fullFileContent,
	headerActions,
	language,
	onAddComment,
	onDeleteComment,
	onResolveComment,
	onViewedChange,
	patch,
	viewed,
}: {
	commentsByChangeKey?: ReadonlyMap<string, readonly DiffComment[]>;
	/** Whether the viewer fills its parent's height (true) or sizes to content. */
	fillHeight?: boolean;
	filePath: string;
	/** Current full file content, enabling the diff ↔ full-file toggle when set. */
	fullFileContent?: string | null;
	headerActions?: ReactNode;
	language?: BundledLanguage;
	/** When set, enables click-a-line commenting; omit for a read-only diff. */
	onAddComment?: (input: AddCommentInput) => void;
	onDeleteComment?: (id: string) => void;
	onResolveComment?: (id: string, resolved: boolean) => void;
	/** When set, the toolbar offers a Viewed marker; omit where nothing tracks it. */
	onViewedChange?: (viewed: boolean) => void;
	patch: string;
	viewed?: boolean;
}) {
	const [viewMode, setViewMode] = useFileScopedState<DiffViewMode>(
		filePath,
		'diff',
	);
	const [activeComposerKey, setActiveComposerKey] = useFileScopedState<
		string | null
	>(filePath, null);
	const layout = useAtomValue(diffLayoutAtom);
	const wordWrap = useAtomValue(diffWordWrapAtom);

	const file = useMemo(() => parseSingleFileDiff(patch), [patch]);
	const resolvedLanguage = language ?? languageForFilePath(filePath);

	const baseHunks = file?.hunks ?? EMPTY_HUNKS;
	const canShowFile = Boolean(fullFileContent) && baseHunks.length > 0;

	const displayHunks = useMemo(
		() => expandHunksForViewMode({ baseHunks, fullFileContent, viewMode }),
		[baseHunks, fullFileContent, viewMode],
	);

	const changeByKey = useMemo(
		() => indexChangesByKey(displayHunks),
		[displayHunks],
	);

	const commentingEnabled = Boolean(onAddComment);

	const openComposer = useCallback(
		(change: ChangeData | null) => {
			if (!change || !commentingEnabled) {
				return;
			}
			setActiveComposerKey(getChangeKey(change));
		},
		[commentingEnabled, setActiveComposerKey],
	);

	const widgets = useDiffWidgets({
		activeComposerKey,
		changeByKey,
		commentsByChangeKey: commentsByChangeKey ?? EMPTY_COMMENTS,
		onAddComment,
		onCloseComposer: () => setActiveComposerKey(null),
		onDeleteComment,
		onResolveComment,
	});

	if (!file || baseHunks.length === 0) {
		return (
			<DiffViewerFrame
				fileModeDisabled
				fillHeight={fillHeight}
				filePath={filePath}
				headerActions={headerActions}
				onViewedChange={onViewedChange}
				onViewModeChange={setViewMode}
				viewed={viewed}
				viewMode={viewMode}
			>
				<CodeBlockContent
					className='min-h-0 flex-1'
					code={patch}
					language={'diff' as BundledLanguage}
					wrapLines={wordWrap}
				/>
			</DiffViewerFrame>
		);
	}

	return (
		<DiffViewerFrame
			fileModeDisabled={!canShowFile}
			fillHeight={fillHeight}
			filePath={filePath}
			headerActions={headerActions}
			onViewedChange={onViewedChange}
			onViewModeChange={setViewMode}
			viewed={viewed}
			viewMode={viewMode}
		>
			<DiffBody
				commentingEnabled={commentingEnabled}
				diffType={file.type}
				hunks={displayHunks}
				language={resolvedLanguage}
				layout={layout}
				onRequestComment={openComposer}
				widgets={widgets}
				wordWrap={wordWrap}
			/>
		</DiffViewerFrame>
	);
}

/**
 * Expand the parsed hunks to whole-file context while the viewer is in file
 * mode and the full source is available, falling back to the diff's own hunks
 * whenever the old source cannot be reconstructed.
 * @param baseHunks - Hunks parsed straight out of the patch
 * @param fullFileContent - Current full file content, when the caller has it
 * @param viewMode - Whether the viewer shows the diff or the whole file
 * @returns The hunks to render
 */
function expandHunksForViewMode({
	baseHunks,
	fullFileContent,
	viewMode,
}: {
	baseHunks: HunkData[];
	fullFileContent: string | null | undefined;
	viewMode: DiffViewMode;
}): HunkData[] {
	if (viewMode !== 'file' || !fullFileContent || baseHunks.length === 0) {
		return baseHunks;
	}
	const oldSource = reconstructOldSource(fullFileContent, baseHunks);
	if (!oldSource) {
		return baseHunks;
	}
	const totalLines = oldSource.split('\n').length;
	return expandFromRawCode(baseHunks, oldSource, 1, totalLines + 1);
}

/**
 * Index every change in the displayed hunks by its stable change key so widgets
 * and the comment composer can resolve a line without rescanning.
 * @param hunks - The hunks currently rendered
 * @returns Each change keyed by {@link getChangeKey}
 */
function indexChangesByKey(
	hunks: readonly HunkData[],
): Map<string, ChangeData> {
	const map = new Map<string, ChangeData>();
	for (const hunk of hunks) {
		for (const change of hunk.changes) {
			map.set(getChangeKey(change), change);
		}
	}
	return map;
}

/**
 * State remembered per file rather than per mount, reading back as `initial` for
 * any file that has not set it.
 *
 * The viewer is mounted once per panel and re-pointed at another file by prop
 * rather than remounted, so plain `useState` survives a tab switch. That leaks:
 * change keys are line numbers with no file in them, so a composer left open on
 * one file matches a real line on the next and reopens itself over the wrong
 * diff, and a `file` view mode carries onto a diff that may not offer it.
 *
 * Held against the path instead of reset on change so each file keeps the mode it
 * was last read in, and so the answer never depends on which files were visited
 * in between.
 * @param filePath - Path the stored value belongs to
 * @param initial - Value read for any file that has not set one
 * @returns The value held for `filePath`, and a setter that records against it
 */
function useFileScopedState<T>(
	filePath: string,
	initial: T,
): [T, (next: T) => void] {
	const [byFile, setByFile] = useState<ReadonlyMap<string, T>>(() => new Map());
	const setValue = useCallback(
		(next: T) => setByFile((current) => new Map(current).set(filePath, next)),
		[filePath],
	);
	const held = byFile.get(filePath);
	return [held === undefined ? initial : held, setValue];
}

/**
 * Label for the gap band shown between two non-adjacent hunks, describing how
 * many unchanged lines the diff skipped between them so the jump in line
 * numbers reads as a deliberate boundary rather than missing content.
 * @param previous - The hunk rendered above the gap
 * @param next - The hunk rendered below the gap
 * @returns A human-readable count of the hidden unchanged lines
 */
function hunkGapLabel(previous: HunkData, next: HunkData): string {
	const hidden = next.oldStart - (previous.oldStart + previous.oldLines);
	if (hidden <= 0) {
		return 'Unchanged lines';
	}
	return `${hidden} unchanged line${hidden === 1 ? '' : 's'}`;
}

/** Stable empty comment map so an omitted `commentsByChangeKey` keeps a fixed identity. */
const EMPTY_COMMENTS: ReadonlyMap<string, readonly DiffComment[]> = new Map();

/**
 * Highest line number either side of a diff reaches, which sizes the gutter to
 * its content so it grows only when line numbers do.
 * @param hunks - The hunks being rendered
 * @returns The largest line number the hunks will render
 */
function highestLineNumber(
	hunks: ReturnType<typeof expandFromRawCode>,
): number {
	let max = 0;
	for (const hunk of hunks) {
		max = Math.max(
			max,
			hunk.oldStart + hunk.oldLines - 1,
			hunk.newStart + hunk.newLines - 1,
		);
	}
	return max;
}

/**
 * Inner diff surface: tokenizes hunks with Shiki and renders the react-diff-view
 * table with line-number gutters and inline comment widgets. Owns the viewer's
 * only scroll container so the frame around it can stay a plain flex column.
 */
function DiffBody({
	commentingEnabled,
	diffType,
	hunks,
	language,
	layout,
	onRequestComment,
	widgets,
	wordWrap,
}: {
	commentingEnabled: boolean;
	diffType: 'add' | 'copy' | 'delete' | 'modify' | 'rename';
	hunks: ReturnType<typeof expandFromRawCode>;
	language: BundledLanguage;
	layout: 'split' | 'unified';
	onRequestComment: (change: ChangeData | null) => void;
	widgets: Record<string, ReactNode>;
	wordWrap: boolean;
}) {
	const showWhitespace = useAtomValue(diffShowWhitespaceAtom);
	const tokens = useDiffTokens(hunks, language, showWhitespace);
	// The gutter column is border-box, so it carries the shared 1ch of padding on
	// either side of the digits the app's other code surfaces add outside theirs.
	const gutterWidthCh = useMemo(
		() => codeGutterDigits(highestLineNumber(hunks)) + 2,
		[hunks],
	);

	// The add-comment control is the only interactive gutter element: it appears
	// on the new side of a hovered row as a shadcn-style button and owns the
	// click. The old-side gutter stays a static line number. Gating on a real
	// new-side line keeps unified view to a single button and blocks commenting
	// on a deleted row, whose new-side line number is null — a comment there
	// would persist against the old line and mis-anchor to the new side on reload.
	//
	// The line number stays in flow, merely hidden, and the button floats over it:
	// the gutter column is sized by its content, so swapping a two-character number
	// for an 18px button would widen the column and shove the whole diff sideways
	// under the cursor.
	const renderAddCommentGutter = useCallback(
		({
			change,
			inHoverState,
			renderDefault,
			side,
		}: {
			change: ChangeData | null;
			inHoverState: boolean;
			renderDefault: () => ReactNode;
			side: 'new' | 'old';
		}) =>
			inHoverState &&
			side === 'new' &&
			change &&
			newLineNumberOf(change) !== null ? (
				<>
					<span className='invisible'>{renderDefault()}</span>
					<button
						aria-label='Add comment'
						className='absolute inset-0 m-auto flex size-4.5 cursor-pointer items-center justify-center rounded-xs bg-foreground text-background shadow-xs transition-colors hover:bg-foreground/90'
						onClick={() => onRequestComment(change)}
						type='button'
					>
						<PlusIcon className='size-3.5' />
					</button>
				</>
			) : (
				renderDefault()
			),
		[onRequestComment],
	);
	const renderGutter = commentingEnabled ? renderAddCommentGutter : undefined;

	return (
		<div
			className={cn(
				'ensemblr-diff-pane sleek-scrollbar min-h-0 flex-1 overflow-auto',
				CODE_SURFACE_CLASSES,
				CODE_PANEL_TEXT_CLASSES,
			)}
			style={{ '--ensemblr-gutter-ch': `${gutterWidthCh}ch` } as CSSProperties}
		>
			<Diff
				className={cn('ensemblr-diff', !wordWrap && 'ensemblr-diff-scroll')}
				codeClassName={wordWrap ? undefined : 'ensemblr-diff-nowrap'}
				diffType={diffType}
				gutterType='default'
				hunks={hunks}
				optimizeSelection
				renderGutter={renderGutter}
				renderToken={renderDiffToken}
				tokens={tokens}
				viewType={layout}
				widgets={widgets}
			>
				{(renderHunks) =>
					renderHunks.flatMap((hunk, index) => {
						const rows = [<Hunk hunk={hunk} key={hunk.content} />];
						if (index === 0) {
							return rows;
						}
						return [
							<Decoration key={`gap-${hunk.content}`}>
								<CodeHunkGap
									label={hunkGapLabel(renderHunks[index - 1], hunk)}
								/>
							</Decoration>,
							...rows,
						];
					})
				}
			</Diff>
		</div>
	);
}

/** Inputs for {@link DiffViewerFrame}: what the header names, and what it offers. */
interface DiffViewerFrameProps {
	children: ReactNode;
	fileModeDisabled: boolean;
	fillHeight: boolean;
	filePath: string;
	headerActions?: ReactNode;
	onViewedChange?: (viewed: boolean) => void;
	onViewModeChange: (mode: DiffViewMode) => void;
	viewed?: boolean;
	viewMode: DiffViewMode;
}

/**
 * Chrome around the diff body: the shared code-viewer header carrying the file
 * path, then the toggle toolbar and the caller's actions.
 *
 * The header is the same bar the file viewer uses, so toggling a tab between a
 * file and its diff moves nothing but the body underneath.
 *
 * The content slot is a flex column rather than a scroll container: whichever
 * body it holds brings its own `overflow-auto`, so a filled-height viewer keeps
 * the horizontal scrollbar pinned to the panel edge instead of stacking a second
 * scroller and pushing it below the last line.
 */
function DiffViewerFrame({
	children,
	fileModeDisabled,
	fillHeight,
	filePath,
	headerActions,
	onViewedChange,
	onViewModeChange,
	viewed,
	viewMode,
}: DiffViewerFrameProps) {
	return (
		<div
			className={cn(
				'flex flex-col overflow-hidden',
				fillHeight && 'min-h-0 flex-1',
			)}
		>
			<CodeViewerHeader
				actions={
					<>
						{headerActions}
						<DiffToolbar
							fileModeDisabled={fileModeDisabled}
							onViewedChange={onViewedChange}
							onViewModeChange={onViewModeChange}
							viewed={viewed}
							viewMode={viewMode}
						/>
					</>
				}
				title={filePath}
			/>
			<div className={cn(fillHeight && 'flex min-h-0 flex-1 flex-col')}>
				{children}
			</div>
		</div>
	);
}

/**
 * Build the react-diff-view `widgets` map: an inline comment thread for every
 * change that has comments or an open composer.
 * @returns A map of change key to the thread element rendered under that line
 */
function useDiffWidgets({
	activeComposerKey,
	changeByKey,
	commentsByChangeKey,
	onAddComment,
	onCloseComposer,
	onDeleteComment,
	onResolveComment,
}: {
	activeComposerKey: string | null;
	changeByKey: ReadonlyMap<string, ChangeData>;
	commentsByChangeKey: ReadonlyMap<string, readonly DiffComment[]>;
	onAddComment?: (input: AddCommentInput) => void;
	onCloseComposer: () => void;
	onDeleteComment?: (id: string) => void;
	onResolveComment?: (id: string, resolved: boolean) => void;
}): Record<string, ReactNode> {
	return useMemo(() => {
		const keys = new Set<string>(commentsByChangeKey.keys());
		if (activeComposerKey) {
			keys.add(activeComposerKey);
		}
		const widgets: Record<string, ReactNode> = {};
		for (const key of keys) {
			const change = changeByKey.get(key);
			const lineNumber = change
				? (newLineNumberOf(change) ?? oldLineNumberOf(change))
				: null;
			widgets[key] = (
				<DiffCommentThread
					comments={commentsByChangeKey.get(key) ?? []}
					composerOpen={activeComposerKey === key}
					onCloseComposer={onCloseComposer}
					onDelete={(id) => onDeleteComment?.(id)}
					onResolve={(id, resolved) => onResolveComment?.(id, resolved)}
					onSubmit={(body) => {
						onAddComment?.({ body, changeKey: key, lineNumber });
						onCloseComposer();
					}}
				/>
			);
		}
		return widgets;
	}, [
		activeComposerKey,
		changeByKey,
		commentsByChangeKey,
		onAddComment,
		onCloseComposer,
		onDeleteComment,
		onResolveComment,
	]);
}
