import type { RecentProject } from '@/renderer/types/workbench';

export const MAX_RECENT_PROJECTS = 8;

/**
 * Move a project to the front of the recents list, de-duplicating by path and
 * capping the list length. Returns a new array; the input is never mutated.
 */
export function recordRecentProject(
	recents: RecentProject[],
	entry: RecentProject,
	limit: number = MAX_RECENT_PROJECTS,
): RecentProject[] {
	const withoutEntry = recents.filter((recent) => recent.path !== entry.path);
	return [entry, ...withoutEntry].slice(0, limit);
}

/** Remove a project from the recents list by path. Returns a new array. */
export function removeRecentProject(
	recents: RecentProject[],
	path: string,
): RecentProject[] {
	return recents.filter((recent) => recent.path !== path);
}
