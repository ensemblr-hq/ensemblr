import type { WatchEventType } from 'node:fs';

import type { WorkspaceFilesChangeFlags } from '../../shared/ipc/contracts/workspace-files';

/** One raw event from a workspace directory watch. */
export interface WorkspaceFileEvent {
	/** `rename` for a create, remove, or move; `change` for a write to an entry that stays. */
	kind: WatchEventType;
	/** Path the OS named, relative to the watched directory; null or empty when it named none. */
	path: string | null;
}

/**
 * Directories whose churn never changes `git ls-files` output but would
 * otherwise trigger refetch storms — `.git` rewrites itself on every git
 * command, and `node_modules` is gitignored in practice. The renderer's polling
 * fallback still covers the rare repo that tracks these paths.
 *
 * They carry the watch's whole cost, so on Linux — where a recursive watch is
 * emulated one OS watch per entry — this set is what the walk never descends
 * into, not just what its events are filtered against.
 */
export const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
	'.git',
	'node_modules',
]);

/**
 * Filenames whose churn never changes the listed tree but recurs constantly —
 * macOS rewrites `.DS_Store` on nearly every Finder interaction. Matched by
 * basename at any depth, plus AppleDouble `._*` sidecars. These are also hidden
 * from the listing itself, so a refetch would never surface them anyway.
 */
const IGNORED_BASENAMES = new Set(['.DS_Store']);

/** Any path this directory holds is a settings input. */
const SETTINGS_DIRECTORY = '.ensemblr';

/** The one settings input that sits at the workspace root rather than in {@link SETTINGS_DIRECTORY}. */
const WORKTREE_INCLUDE_FILE = '.worktreeinclude';

/** A `.gitignore` decides which entries the listing shows, wherever it sits. */
const GITIGNORE_FILE = '.gitignore';

/** Flags for a burst in which nothing has been raised yet. */
export const NO_FILE_CHANGES: WorkspaceFilesChangeFlags = {
	membershipChanged: false,
	settingsChanged: false,
};

/**
 * Splits a watcher path into its segments, whichever separator the platform's
 * watch reported it with.
 * @param changed - Path relative to the watched directory.
 * @returns The path's segments, outermost first.
 */
function segmentsOf(changed: string): string[] {
	return changed.split(/[/\\]/);
}

/**
 * True when a change is confined to a directory `git ls-files` never lists.
 * Every segment is tested, not just the first, so a monorepo package's nested
 * `node_modules` is filtered the same way a root one is — and the same way the
 * Linux walk already skips those names at any depth.
 * @param changed - Path relative to the watched directory, or null when unnamed.
 * @returns Whether the event is noise no consumer needs to hear about.
 */
export function isIgnoredChange(changed: string | null): boolean {
	if (!changed) {
		return false;
	}

	const segments = segmentsOf(changed);
	if (segments.some((segment) => IGNORED_DIRECTORY_NAMES.has(segment))) {
		return true;
	}

	const basename = segments.at(-1) ?? changed;
	return IGNORED_BASENAMES.has(basename) || basename.startsWith('._');
}

/**
 * Works out what one watcher event may have changed. Membership is raised by
 * anything that can add or drop a row — a `rename`, which is how every platform
 * reports a create, remove, or move — and by a `.gitignore` edit, which moves
 * rows without any entry being created or removed. Settings are raised by the
 * files the settings resolver reads. An event with no path could be either.
 *
 * The two settings names mirror `ENSEMBLR_DIRECTORY` and
 * `WORKTREE_INCLUDE_FILENAME` in `src/main/config`; the watcher tests pin them
 * to those constants without this concern importing the config parser.
 * @param event - The raw watcher event.
 * @returns The flags this one event raises.
 */
export function classifyWorkspaceFileEvent({
	kind,
	path: changed,
}: WorkspaceFileEvent): WorkspaceFilesChangeFlags {
	if (!changed) {
		return { membershipChanged: true, settingsChanged: true };
	}

	const segments = segmentsOf(changed);
	const basename = segments.at(-1);

	return {
		membershipChanged: kind === 'rename' || basename === GITIGNORE_FILE,
		settingsChanged:
			segments[0] === SETTINGS_DIRECTORY ||
			(segments.length === 1 && basename === WORKTREE_INCLUDE_FILE),
	};
}

/**
 * Folds one event's flags into a burst's, keeping every flag either raised.
 * @param burst - Flags the burst has accumulated so far.
 * @param event - Flags the next event raised.
 * @returns A new flag set; neither input is modified.
 */
export function mergeFileChangeFlags(
	burst: WorkspaceFilesChangeFlags,
	event: WorkspaceFilesChangeFlags,
): WorkspaceFilesChangeFlags {
	return {
		membershipChanged: burst.membershipChanged || event.membershipChanged,
		settingsChanged: burst.settingsChanged || event.settingsChanged,
	};
}
