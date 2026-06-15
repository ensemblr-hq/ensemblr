import { useMemo } from 'react';
import { fuzzyScore } from '@/renderer/lib/workbench/fuzzy-score';
import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

const DEFAULT_MENTION_LIMIT = 80;
const MIN_DRILLDOWN_QUERY_LENGTH = 2;

interface ScoredWorkspaceFile {
	entry: WorkspaceFileSummary;
	score: number;
}

/** Returns true when an entry is at the repository root. */
function isRootEntry(entry: WorkspaceFileSummary): boolean {
	return !entry.path.includes('/');
}

/** Returns true when an entry is an immediate child of the provided directory. */
function isDirectChildOf(
	entry: WorkspaceFileSummary,
	directoryPath: string,
): boolean {
	if (!directoryPath) {
		return isRootEntry(entry);
	}
	const prefix = `${directoryPath}/`;
	if (!entry.path.startsWith(prefix)) {
		return false;
	}
	const relativePath = entry.path.slice(prefix.length);
	return relativePath.length > 0 && !relativePath.includes('/');
}

/** Sorts directories before files, then by fuzzy score and stable path label. */
function sortMentionEntries(
	left: ScoredWorkspaceFile,
	right: ScoredWorkspaceFile,
): number {
	if (left.entry.kind !== right.entry.kind) {
		return left.entry.kind === 'directory' ? -1 : 1;
	}
	if (left.score !== right.score) {
		return right.score - left.score;
	}
	return left.entry.path.localeCompare(right.entry.path);
}

/** Scores entries by name first, then path, preserving hierarchy-first behavior. */
function scoreEntry(entry: WorkspaceFileSummary, query: string): number {
	return Math.max(fuzzyScore(entry.name, query), fuzzyScore(entry.path, query));
}

/** Returns direct child entries for a directory query such as `src/renderer`. */
function directChildrenForQuery(
	entries: readonly WorkspaceFileSummary[],
	query: string,
): WorkspaceFileSummary[] {
	const slashIndex = query.lastIndexOf('/');
	const parentPath = query.slice(0, slashIndex).replace(/\/+$/g, '');
	const childQuery = query.slice(slashIndex + 1);
	const scored: ScoredWorkspaceFile[] = [];

	for (const entry of entries) {
		if (!isDirectChildOf(entry, parentPath)) {
			continue;
		}
		const score = fuzzyScore(entry.name, childQuery);
		if (score > 0) {
			scored.push({ entry, score });
		}
	}

	return scored.sort(sortMentionEntries).map((item) => item.entry);
}

/** Returns root-level entries matching the current top-level query. */
function rootMatchesForQuery(
	entries: readonly WorkspaceFileSummary[],
	query: string,
): WorkspaceFileSummary[] {
	const scored: ScoredWorkspaceFile[] = [];
	for (const entry of entries) {
		if (!isRootEntry(entry)) {
			continue;
		}
		const score = query ? scoreEntry(entry, query) : 1;
		if (score > 0) {
			scored.push({ entry, score });
		}
	}
	return scored.sort(sortMentionEntries).map((item) => item.entry);
}

/** Returns immediate children for root folders that match enough typed text. */
function drilldownMatchesForQuery(
	entries: readonly WorkspaceFileSummary[],
	query: string,
): WorkspaceFileSummary[] {
	const normalizedQuery = query.toLowerCase();
	if (normalizedQuery.length < MIN_DRILLDOWN_QUERY_LENGTH) {
		return [];
	}

	const matchingRootFolders = entries.filter(
		(entry) =>
			entry.kind === 'directory' &&
			isRootEntry(entry) &&
			entry.name.toLowerCase().startsWith(normalizedQuery),
	);
	const scored: ScoredWorkspaceFile[] = [];
	for (const folder of matchingRootFolders) {
		for (const entry of entries) {
			if (isDirectChildOf(entry, folder.path)) {
				scored.push({ entry, score: 1 });
			}
		}
	}
	return scored.sort(sortMentionEntries).map((item) => item.entry);
}

/** Returns deep fuzzy matches as a fallback once the user typed a query. */
function deepFallbackMatchesForQuery(
	entries: readonly WorkspaceFileSummary[],
	query: string,
): WorkspaceFileSummary[] {
	if (!query) {
		return [];
	}
	const scored: ScoredWorkspaceFile[] = [];
	for (const entry of entries) {
		const score = scoreEntry(entry, query);
		if (score > 0) {
			scored.push({ entry, score });
		}
	}
	return scored.sort(sortMentionEntries).map((item) => item.entry);
}

/** Deduplicates match groups while preserving first-seen order. */
function dedupeEntries(
	entries: readonly WorkspaceFileSummary[],
): WorkspaceFileSummary[] {
	const seen = new Set<string>();
	const result: WorkspaceFileSummary[] = [];
	for (const entry of entries) {
		if (seen.has(entry.path)) {
			continue;
		}
		seen.add(entry.path);
		result.push(entry);
	}
	return result;
}

/** Builds hierarchical @ mention matches from a flat workspace file list. */
export function getMentionMatches(
	entries: readonly WorkspaceFileSummary[],
	query: string,
	limit = DEFAULT_MENTION_LIMIT,
): WorkspaceFileSummary[] {
	const normalizedQuery = query.trim().replace(/^@/, '');
	const matches = normalizedQuery.includes('/')
		? directChildrenForQuery(entries, normalizedQuery)
		: dedupeEntries([
				...rootMatchesForQuery(entries, normalizedQuery),
				...drilldownMatchesForQuery(entries, normalizedQuery),
				...deepFallbackMatchesForQuery(entries, normalizedQuery),
			]);

	return matches.slice(0, limit);
}

/** Memoized hook for composer @ mention matches. */
export function useMentionMatches(
	entries: readonly WorkspaceFileSummary[],
	query: string,
	limit = DEFAULT_MENTION_LIMIT,
): WorkspaceFileSummary[] {
	return useMemo(
		() => getMentionMatches(entries, query, limit),
		[entries, query, limit],
	);
}
