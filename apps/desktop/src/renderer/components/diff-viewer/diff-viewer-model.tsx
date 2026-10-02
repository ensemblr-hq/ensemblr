import { useAtomValue } from 'jotai';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	type ChangeData,
	expandFromRawCode,
	getChangeKey,
	type HunkData,
} from 'react-diff-view';
import type { BundledLanguage } from 'shiki';

import {
	newLineNumberOf,
	oldLineNumberOf,
	parseSingleFileDiff,
	reconstructOldSource,
	resolveChangeKey,
} from '@/renderer/lib/diff/parse';
import { languageForFilePath } from '@/renderer/lib/language-from-path';
import { diffLayoutAtom, diffWordWrapAtom } from '@/renderer/state/preferences';
import type {
	DiffComment,
	DiffLineReveal,
	DiffViewMode,
} from '@/renderer/types/diff';

import { DiffCommentThread } from './diff-comment-thread';

const EMPTY_HUNKS: HunkData[] = [];

/** Stable empty comment map so an omitted `commentsByChangeKey` keeps a fixed identity. */
const EMPTY_COMMENTS: ReadonlyMap<string, readonly DiffComment[]> = new Map();

/** How long a revealed line stays flashed before the highlight is dropped. */
const REVEAL_FLASH_MS = 1_600;

/** Details of the line a new comment is being added to. */
export interface AddCommentInput {
	body: string;
	changeKey: string;
	lineNumber: number | null;
}

/** A resolved reveal: the row to scroll to, tagged with the request that asked. */
export interface RevealedRow {
	changeKey: string;
	requestId: number;
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

/**
 * Everything the diff viewer renders from, in one hook: the parsed patch, the
 * hunks the current view mode expands to, per-file view state, the inline
 * comment widgets, and the resolved line reveal. Holding the orchestration here
 * leaves the component itself a choice between two frames.
 * @param input - The viewer's data props and comment callbacks
 * @returns The parsed file, the render inputs, and the view state the frame drives
 */
export function useDiffViewerModel({
	commentsByChangeKey,
	filePath,
	fullFileContent,
	fullFileContentPending,
	language,
	onAddComment,
	onDeleteComment,
	onResolveComment,
	onRevealSettled,
	patch,
	reveal,
}: {
	commentsByChangeKey?: ReadonlyMap<string, readonly DiffComment[]>;
	filePath: string;
	fullFileContent?: string | null;
	fullFileContentPending: boolean;
	language?: BundledLanguage;
	onAddComment?: (input: AddCommentInput) => void;
	onDeleteComment?: (id: string) => void;
	onResolveComment?: (id: string, resolved: boolean) => void;
	onRevealSettled?: (requestId: number) => void;
	patch: string;
	reveal?: DiffLineReveal | null;
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

	return {
		canShowFile,
		commentingEnabled,
		displayHunks,
		file,
		hasHunks: baseHunks.length > 0,
		layout,
		openComposer,
		resolvedLanguage: language ?? languageForFilePath(filePath),
		revealed,
		setViewMode,
		viewMode,
		widgets,
		wordWrap,
	};
}
