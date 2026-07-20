import { useAtomValue } from 'jotai';
import { PlusIcon, UnfoldVerticalIcon } from 'lucide-react';
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
import { languageForFilePath } from '@/renderer/lib/language-from-path';
import { cn } from '@/renderer/lib/utils';
import {
	diffLayoutAtom,
	diffShowWhitespaceAtom,
	diffWordWrapAtom,
} from '@/renderer/state/preferences';
import { type DiffComment, DiffCommentThread } from './diff-comment-thread';
import { DiffToolbar } from './diff-toolbar';
import {
	newLineNumberOf,
	oldLineNumberOf,
	parseSingleFileDiff,
	reconstructOldSource,
} from './parse';
import { renderDiffToken, useDiffTokens } from './shiki-tokenize';

const EMPTY_HUNKS: HunkData[] = [];

/** Whether the viewer shows only the diff hunks or the whole expanded file. */
export type DiffViewMode = 'diff' | 'file';

/** Details of the line a new comment is being added to. */
export interface AddCommentInput {
	body: string;
	changeKey: string;
	lineNumber: number | null;
}

/**
 * Rich single-file diff viewer: parsed hunks with line-number gutters, Shiki
 * syntax colors, click-a-line inline comments (local editable + GitHub/bot
 * read-only), and toggles for full-file view, split layout, hidden characters,
 * and word wrap. Falls back to a plain highlighted patch when the diff cannot
 * be parsed.
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
	patch,
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
	patch: string;
}) {
	const [viewMode, setViewMode] = useState<DiffViewMode>('diff');
	const [activeComposerKey, setActiveComposerKey] = useState<string | null>(
		null,
	);
	const layout = useAtomValue(diffLayoutAtom);
	const wordWrap = useAtomValue(diffWordWrapAtom);

	const file = useMemo(() => parseSingleFileDiff(patch), [patch]);
	const resolvedLanguage = language ?? languageForFilePath(filePath);

	const baseHunks = file?.hunks ?? EMPTY_HUNKS;
	const canShowFile = Boolean(fullFileContent) && baseHunks.length > 0;

	const displayHunks = useMemo(() => {
		if (viewMode !== 'file' || !fullFileContent || baseHunks.length === 0) {
			return baseHunks;
		}
		const oldSource = reconstructOldSource(fullFileContent, baseHunks);
		if (!oldSource) {
			return baseHunks;
		}
		const totalLines = oldSource.split('\n').length;
		return expandFromRawCode(baseHunks, oldSource, 1, totalLines + 1);
	}, [viewMode, fullFileContent, baseHunks]);

	const changeByKey = useMemo(() => {
		const map = new Map<string, ChangeData>();
		for (const hunk of displayHunks) {
			for (const change of hunk.changes) {
				map.set(getChangeKey(change), change);
			}
		}
		return map;
	}, [displayHunks]);

	const commentingEnabled = Boolean(onAddComment);

	const openComposer = useCallback(
		(change: ChangeData | null) => {
			if (!change || !commentingEnabled) {
				return;
			}
			setActiveComposerKey(getChangeKey(change));
		},
		[commentingEnabled],
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
				headerActions={headerActions}
				onViewModeChange={setViewMode}
				viewMode={viewMode}
			>
				<CodeBlockContent code={patch} language={'diff' as BundledLanguage} />
			</DiffViewerFrame>
		);
	}

	return (
		<DiffViewerFrame
			fileModeDisabled={!canShowFile}
			fillHeight={fillHeight}
			headerActions={headerActions}
			onViewModeChange={setViewMode}
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
 * Widest line-number digit count across a diff's hunks, used to size the gutter
 * to its content (minimum two digits) so it grows only when line numbers do.
 * @param hunks - The hunks being rendered
 * @returns The number of digits in the largest line number (at least 2)
 */
function maxLineDigits(hunks: ReturnType<typeof expandFromRawCode>): number {
	let max = 0;
	for (const hunk of hunks) {
		max = Math.max(
			max,
			hunk.oldStart + hunk.oldLines,
			hunk.newStart + hunk.newLines,
		);
	}
	return Math.max(2, String(max).length);
}

/**
 * Inner diff surface: tokenizes hunks with Shiki and renders the react-diff-view
 * table with line-number gutters and inline comment widgets.
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
	const gutterWidthCh = useMemo(() => maxLineDigits(hunks) + 1, [hunks]);

	// The add-comment control is the only interactive gutter element: it appears
	// on the new side of a hovered row as a shadcn-style button and owns the
	// click. The old-side gutter stays a static line number. Gating on a real
	// new-side line keeps unified view to a single button and blocks commenting
	// on a deleted row, whose new-side line number is null — a comment there
	// would persist against the old line and mis-anchor to the new side on reload.
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
				<button
					aria-label='Add comment'
					className='mx-auto flex size-4.5 items-center justify-center rounded-xs bg-foreground text-background shadow-xs transition-colors hover:bg-foreground/90'
					onClick={() => onRequestComment(change)}
					type='button'
				>
					<PlusIcon className='size-3.5' />
				</button>
			) : (
				renderDefault()
			),
		[onRequestComment],
	);
	const renderGutter = commentingEnabled ? renderAddCommentGutter : undefined;

	return (
		<div
			className='overflow-x-auto'
			style={{ '--ensemblr-gutter-ch': `${gutterWidthCh}ch` } as CSSProperties}
		>
			<Diff
				className='ensemblr-diff'
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
								<div className='ensemblr-diff-gap'>
									<UnfoldVerticalIcon className='size-3' />
									{hunkGapLabel(renderHunks[index - 1], hunk)}
								</div>
							</Decoration>,
							...rows,
						];
					})
				}
			</Diff>
		</div>
	);
}

/** Chrome around the diff body: the file path header, toggle toolbar, and actions. */
function DiffViewerFrame({
	children,
	fileModeDisabled,
	fillHeight,
	headerActions,
	onViewModeChange,
	viewMode,
}: {
	children: ReactNode;
	fileModeDisabled: boolean;
	fillHeight: boolean;
	headerActions?: ReactNode;
	onViewModeChange: (mode: DiffViewMode) => void;
	viewMode: DiffViewMode;
}) {
	return (
		<div
			className={cn(
				'flex flex-col overflow-hidden',
				fillHeight && 'min-h-0 flex-1',
			)}
		>
			<div className='flex h-9 shrink-0 items-center gap-2 border-border border-b bg-muted/30 px-2'>
				<DiffToolbar
					fileModeDisabled={fileModeDisabled}
					onViewModeChange={onViewModeChange}
					viewMode={viewMode}
				/>
				<div className='ml-auto flex items-center gap-1'>{headerActions}</div>
			</div>
			<div className={cn(fillHeight && 'min-h-0 flex-1 overflow-auto')}>
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
