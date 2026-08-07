import { useAtomValue } from 'jotai';
import { PlusIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
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
	resolveChangeKey,
} from '@/renderer/lib/diff/parse';
import { languageForFilePath } from '@/renderer/lib/language-from-path';
import { cn } from '@/renderer/lib/utils';
import {
	diffLayoutAtom,
	diffShowWhitespaceAtom,
	diffWordWrapAtom,
} from '@/renderer/state/preferences';
import type {
	DiffComment,
	DiffLineReveal,
	DiffViewMode,
} from '@/renderer/types/diff';
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
	fullFileContentPending = false,
	headerActions,
	language,
	onAddComment,
	onDeleteComment,
	onResolveComment,
	onRevealSettled,
	onViewedChange,
	patch,
	reveal,
	viewed,
}: {
	commentsByChangeKey?: ReadonlyMap<string, readonly DiffComment[]>;
	/** Whether the viewer fills its parent's height (true) or sizes to content. */
	fillHeight?: boolean;
	filePath: string;
	/** Current full file content, enabling the diff ↔ full-file toggle when set. */
	fullFileContent?: string | null;
	/**
	 * Whether `fullFileContent` is still on its way. Separates "no source yet"
	 * from "no source at all", which a `null` cannot say on its own and which a
	 * pending reveal has to know before it gives up on reaching a line.
	 */
	fullFileContentPending?: boolean;
	headerActions?: ReactNode;
	language?: BundledLanguage;
	/** When set, enables click-a-line commenting; omit for a read-only diff. */
	onAddComment?: (input: AddCommentInput) => void;
	onDeleteComment?: (id: string) => void;
	onResolveComment?: (id: string, resolved: boolean) => void;
	/** Reports a `reveal` as served or unreachable, so its owner can drop it. */
	onRevealSettled?: (requestId: number) => void;
	/** When set, the toolbar offers a Viewed marker; omit where nothing tracks it. */
	onViewedChange?: (viewed: boolean) => void;
	patch: string;
	/** When set, scrolls to and flashes the requested line once per `requestId`. */
	reveal?: DiffLineReveal | null;
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

	const revealed = useLineReveal({
		canShowFile,
		displayHunks,
		fullFileContentPending,
		onRevealSettled,
		reveal,
		setViewMode,
		viewMode,
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
				revealed={revealed}
				widgets={widgets}
				wordWrap={wordWrap}
			/>
		</DiffViewerFrame>
	);
}

/** How long a revealed line stays flashed before the highlight is dropped. */
const REVEAL_FLASH_MS = 1_600;

/** A resolved reveal: the row to scroll to, tagged with the request that asked. */
interface RevealedRow {
	changeKey: string;
	requestId: number;
}

/**
 * Resolve a pending reveal to the change key of the row it lands on, escalating
 * to full-file view once when the line falls outside the rendered hunks.
 *
 * Every input that can change the rendered row set is a dependency, so React
 * re-runs this exactly when a retry could succeed — there is nothing to poll
 * for. Two refs keyed on `requestId` bound the work: at most one escalation and
 * one give-up per request, so a line that is nowhere in the file cannot loop.
 * The `requestId` rides along with the key rather than being dropped once the
 * key is known: a repeat jump to the same line resolves to the same key, and a
 * consumer watching the key alone would see no change and never scroll again.
 *
 * Settling is reported to the caller as well as recorded here, because the refs
 * are mount-scoped: without the report the request outlives the panel and the
 * next mount of the same file replays the jump.
 * @param input - The pending reveal, the rendered hunks, and the view-mode seam
 * @returns The row to scroll to and flash, or null
 */
function useLineReveal({
	canShowFile,
	displayHunks,
	fullFileContentPending,
	onRevealSettled,
	reveal,
	setViewMode,
	viewMode,
}: {
	canShowFile: boolean;
	displayHunks: readonly HunkData[];
	fullFileContentPending: boolean;
	onRevealSettled?: (requestId: number) => void;
	reveal?: DiffLineReveal | null;
	setViewMode: (mode: DiffViewMode) => void;
	viewMode: DiffViewMode;
}): RevealedRow | null {
	const [revealed, setRevealed] = useState<RevealedRow | null>(null);
	const escalatedForRef = useRef<number | null>(null);
	const settledForRef = useRef<number | null>(null);

	useEffect(() => {
		if (!reveal || settledForRef.current === reveal.requestId) {
			return;
		}
		const settle = () => {
			settledForRef.current = reveal.requestId;
			onRevealSettled?.(reveal.requestId);
		};
		const changeKey = resolveChangeKey(displayHunks, reveal.line, reveal.side);
		if (changeKey) {
			settle();
			setRevealed({ changeKey, requestId: reveal.requestId });
			return;
		}
		if (viewMode === 'diff' && escalatedForRef.current !== reveal.requestId) {
			// A comment can sit on a line the diff never touched, and only the whole
			// file can place it. That source loads on its own query, which cannot
			// even start until the diff's has resolved — so giving up before it
			// arrives would make this escalation unreachable in the app.
			if (fullFileContentPending) {
				return;
			}
			if (canShowFile) {
				escalatedForRef.current = reveal.requestId;
				setViewMode('file');
				return;
			}
		}
		settle();
	}, [
		canShowFile,
		displayHunks,
		fullFileContentPending,
		onRevealSettled,
		reveal,
		setViewMode,
		viewMode,
	]);

	useEffect(() => {
		if (!revealed) {
			return;
		}
		const timer = setTimeout(() => setRevealed(null), REVEAL_FLASH_MS);
		return () => clearTimeout(timer);
	}, [revealed]);

	return revealed;
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

/** Stable empty selection so an idle viewer keeps a fixed `selectedChanges` identity. */
const EMPTY_SELECTION: string[] = [];

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
	revealed,
	widgets,
	wordWrap,
}: {
	commentingEnabled: boolean;
	diffType: 'add' | 'copy' | 'delete' | 'modify' | 'rename';
	hunks: ReturnType<typeof expandFromRawCode>;
	language: BundledLanguage;
	layout: 'split' | 'unified';
	onRequestComment: (change: ChangeData | null) => void;
	/** The row to scroll to and flash, or null. */
	revealed: RevealedRow | null;
	widgets: Record<string, ReactNode>;
	wordWrap: boolean;
}) {
	const paneRef = useRef<HTMLDivElement>(null);
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

	// react-diff-view stamps `data-change-key` on every gutter and code cell, so
	// the row is addressable without a render hook of our own. Scoped to the pane
	// because a page can mount several viewers and a change key carries no file.
	// Instant rather than smooth: comment widgets resolve from their own queries
	// and can push rows down after the first paint, which a running animation
	// would fight; centring absorbs that drift instead.
	useLayoutEffect(() => {
		if (!revealed) {
			return;
		}
		paneRef.current
			?.querySelector(`[data-change-key="${revealed.changeKey}"]`)
			?.closest('tr')
			?.scrollIntoView({ block: 'center' });
		// Keyed on the request, not the change key: jumping twice to the same line
		// resolves to the same key, and watching the key alone would scroll once.
	}, [revealed]);

	const selectedChanges = useMemo(
		() => (revealed ? [revealed.changeKey] : EMPTY_SELECTION),
		[revealed],
	);

	return (
		<div
			className={cn(
				'ensemblr-diff-pane sleek-scrollbar min-h-0 flex-1 overflow-auto',
				CODE_SURFACE_CLASSES,
				CODE_PANEL_TEXT_CLASSES,
			)}
			ref={paneRef}
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
				selectedChanges={selectedChanges}
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
