import { useMemo } from 'react';

import { isPreviewableWorkspaceFile } from '@/renderer/lib/workbench';
import { fuzzyScore } from '@/renderer/lib/workbench/fuzzy-score';
import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

/**
 * How many rows the file-search list renders at once. The listing behind it
 * carries up to 5,000 entries, each of which would mount a row and register
 * itself with cmdk, so the cap is what keeps typing responsive rather than a
 * display preference. A query narrow enough to name a file reaches it long
 * before the cap bites.
 */
const FILE_SEARCH_LIMIT = 50;

/** A previewable workspace file paired with its fuzzy-match score. */
interface ScoredFile {
	file: WorkspaceFileSummary;
	score: number;
}

/**
 * Scores a file by its name first and its full path second, so the file the
 * user named outranks a deep path that merely contains the same letters.
 * @param file - Workspace file being ranked.
 * @param needle - Trimmed query typed by the user.
 * @returns The match score; 0 means no match.
 */
function scoreFile(file: WorkspaceFileSummary, needle: string): number {
	return Math.max(fuzzyScore(file.name, needle), fuzzyScore(file.path, needle));
}

/**
 * Orders matches by descending score, then by the shorter path, then
 * alphabetically, so equally scored rows hold the same order across keystrokes.
 * @param left - First match.
 * @param right - Second match.
 * @returns Negative when `left` sorts first, positive when `right` does.
 */
function compareScoredFiles(left: ScoredFile, right: ScoredFile): number {
	if (left.score !== right.score) {
		return right.score - left.score;
	}
	if (left.file.path.length !== right.file.path.length) {
		return left.file.path.length - right.file.path.length;
	}
	return left.file.path.localeCompare(right.file.path);
}

/**
 * Takes the leading previewable files in listing order, for the empty query the
 * dialog opens with.
 * @param files - Every entry the workspace listing reported.
 * @param limit - How many rows to return.
 * @returns The leading previewable files.
 */
function leadingPreviewableFiles(
	files: readonly WorkspaceFileSummary[],
	limit: number,
): WorkspaceFileSummary[] {
	const leading: WorkspaceFileSummary[] = [];
	for (const file of files) {
		if (leading.length >= limit) {
			break;
		}
		if (isPreviewableWorkspaceFile(file)) {
			leading.push(file);
		}
	}
	return leading;
}

/**
 * Scores every previewable file against the query and keeps the best rows.
 * @param files - Every entry the workspace listing reported.
 * @param needle - Trimmed query typed by the user.
 * @param limit - How many rows to return.
 * @returns The highest-scoring files, best first.
 */
function bestMatchingFiles(
	files: readonly WorkspaceFileSummary[],
	needle: string,
	limit: number,
): WorkspaceFileSummary[] {
	const scored: ScoredFile[] = [];
	for (const file of files) {
		if (!isPreviewableWorkspaceFile(file)) {
			continue;
		}
		const score = scoreFile(file, needle);
		if (score > 0) {
			scored.push({ file, score });
		}
	}
	return scored
		.sort(compareScoredFiles)
		.slice(0, limit)
		.map((entry) => entry.file);
}

/**
 * Ranks the previewable workspace files a file-search query matches, capped so
 * the list stays a fixed size however large the workspace is.
 * @param files - Every entry the workspace listing reported.
 * @param query - The search box's current text.
 * @param limit - How many rows to return.
 * @returns The files to render, best match first.
 */
export function rankFileSearchMatches(
	files: readonly WorkspaceFileSummary[],
	query: string,
	limit = FILE_SEARCH_LIMIT,
): WorkspaceFileSummary[] {
	const needle = query.trim();
	return needle
		? bestMatchingFiles(files, needle, limit)
		: leadingPreviewableFiles(files, limit);
}

/** Memoized hook for the file-search dialog's result list. */
export function useFileSearchMatches(
	files: readonly WorkspaceFileSummary[],
	query: string,
	limit = FILE_SEARCH_LIMIT,
): WorkspaceFileSummary[] {
	return useMemo(
		() => rankFileSearchMatches(files, query, limit),
		[files, query, limit],
	);
}
