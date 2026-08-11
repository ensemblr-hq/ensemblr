import type { LinkedDirectoryRecentRow } from '../storage/repositories/linked-directory-repository.ts';

/**
 * How many directories the recents list keeps. Small on purpose: the list is a
 * shortcut back to the handful of folders a user actually works out of, and a
 * longer one turns the picker into something you have to search rather than
 * recognise.
 */
export const LINKED_DIRECTORY_RECENTS_LIMIT = 12;

/**
 * Moves a directory to the head of the recents list, deduped by path and capped
 * at {@link LINKED_DIRECTORY_RECENTS_LIMIT}. Pure — the caller persists the
 * result.
 * @param entries - The current list, newest first.
 * @param entry - The directory just linked.
 * @returns A new list with `entry` at the head and no duplicate of its path.
 */
export function mergeLinkedDirectoryRecent(
	entries: readonly LinkedDirectoryRecentRow[],
	entry: LinkedDirectoryRecentRow,
): readonly LinkedDirectoryRecentRow[] {
	const withoutEntry = entries.filter(
		(candidate) => candidate.path !== entry.path,
	);
	return [entry, ...withoutEntry].slice(0, LINKED_DIRECTORY_RECENTS_LIMIT);
}

/**
 * Removes a directory from the recents list.
 * @param entries - The current list, newest first.
 * @param path - Absolute path to drop.
 * @returns A new list without that path.
 */
export function dropLinkedDirectoryRecent(
	entries: readonly LinkedDirectoryRecentRow[],
	path: string,
): readonly LinkedDirectoryRecentRow[] {
	return entries.filter((candidate) => candidate.path !== path);
}
