import { watch } from 'node:fs';
import path from 'node:path';

import { startLinuxRecursiveWatch } from './linux-recursive-watch.ts';

const WATCH_DEBOUNCE_MS = 250;

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
const IGNORED_DIRECTORY_NAMES = new Set(['.git', 'node_modules']);

/**
 * Filenames whose churn never changes the listed tree but recurs constantly —
 * macOS rewrites `.DS_Store` on nearly every Finder interaction. Matched by
 * basename at any depth, plus AppleDouble `._*` sidecars. These are also hidden
 * from the listing itself, so a refetch would never surface them anyway.
 */
const IGNORED_BASENAMES = new Set(['.DS_Store']);

/** Handle to a single OS watch; `close` releases it. */
interface WatchHandle {
	close: () => void;
}

/**
 * Starts one recursive directory watch. Abstracted so tests can drive synthetic
 * change/error events without touching the real filesystem.
 * @param directory - Absolute directory to watch recursively.
 * @param onChange - Called with the changed path (relative to `directory`).
 * @param onError - Called when the underlying watcher errors.
 * @returns A handle whose `close` stops the watch.
 */
export type StartWatch = (
	directory: string,
	onChange: (changed: string | null) => void,
	onError: () => void,
) => WatchHandle;

/** Internal per-directory watch state: OS handle, debounce timer, and reference count. */
interface WatchEntry {
	debounce: ReturnType<typeof setTimeout> | null;
	handle: WatchHandle;
	refCount: number;
}

/** Reference-counted watcher surface for workspace directory file changes. */
export interface WorkspaceFilesWatcher {
	/** Begin (or ref-count) watching a workspace directory for file changes. */
	watch: (workspaceCwd: string) => void;
	/** Drop one watch reference; closes the OS watcher once it reaches zero. */
	unwatch: (workspaceCwd: string) => void;
	/**
	 * Closes one directory's watcher whatever its reference count, for a
	 * workspace being removed. `unwatch` cannot serve here: it drops a single
	 * reference, and a workspace open in two windows would keep watching a
	 * directory that is being unlinked.
	 */
	stopWatching: (workspaceCwd: string) => void;
	/** Closes every watcher and pending timer; call on app quit. */
	stopAll: () => void;
}

/** Options for constructing a {@link WorkspaceFilesWatcher}. */
export interface CreateWorkspaceFilesWatcherOptions {
	/** Notified (debounced, per cwd) when a non-ignored file change is seen. */
	onChange: (workspaceCwd: string) => void;
	/** Watch primitive; defaults to a recursive `fs.watch`. Injected in tests. */
	startWatch?: StartWatch;
}

/**
 * Watches workspace directories recursively and emits debounced change
 * notifications so the renderer can refresh its file list in near-real-time.
 *
 * Reference-counts by cwd so repeated subscriptions (React strict-mode double
 * mounts, multiple windows on the same workspace) share a single OS watcher and
 * a single `unwatch` releases the right amount.
 * @param options - Change callback plus optional watch-primitive override.
 * @returns Watcher handle with watch/unwatch/stopAll controls.
 */
export function createWorkspaceFilesWatcher({
	onChange,
	startWatch = defaultStartWatch,
}: CreateWorkspaceFilesWatcherOptions): WorkspaceFilesWatcher {
	const entries = new Map<string, WatchEntry>();

	const scheduleChange = (workspaceCwd: string): void => {
		const entry = entries.get(workspaceCwd);

		if (!entry) {
			return;
		}

		if (entry.debounce) {
			clearTimeout(entry.debounce);
		}

		entry.debounce = setTimeout(() => {
			entry.debounce = null;
			onChange(workspaceCwd);
		}, WATCH_DEBOUNCE_MS);
	};

	const closeEntry = (entry: WatchEntry): void => {
		if (entry.debounce) {
			clearTimeout(entry.debounce);
			entry.debounce = null;
		}

		entry.handle.close();
	};

	/**
	 * Closes one directory's watcher and forgets it, whatever its reference
	 * count. The single teardown path: `unwatch` reaching zero, a watcher error,
	 * and `stopWatching` all end here so the three cannot drift.
	 * @param workspaceCwd - Absolute path of the watched directory
	 */
	const closeWatch = (workspaceCwd: string): void => {
		const entry = entries.get(workspaceCwd);

		if (!entry) {
			return;
		}

		closeEntry(entry);
		entries.delete(workspaceCwd);
	};

	return {
		watch(workspaceCwd) {
			if (!path.isAbsolute(workspaceCwd)) {
				return;
			}

			const existing = entries.get(workspaceCwd);

			if (existing) {
				existing.refCount += 1;
				return;
			}

			let handle: WatchHandle;

			try {
				handle = startWatch(
					workspaceCwd,
					(changed) => {
						if (!isIgnoredChange(changed)) {
							scheduleChange(workspaceCwd);
						}
					},
					// A watcher error (e.g. the directory was removed) must not crash
					// main; drop the entry so a later watch() can re-establish it.
					() => {
						closeWatch(workspaceCwd);
					},
				);
			} catch {
				// Recursive watch is unsupported on some platforms; the renderer's
				// polling fallback keeps the tree fresh without it.
				return;
			}

			entries.set(workspaceCwd, { debounce: null, handle, refCount: 1 });
		},
		unwatch(workspaceCwd) {
			const entry = entries.get(workspaceCwd);

			if (!entry) {
				return;
			}

			entry.refCount -= 1;

			if (entry.refCount > 0) {
				return;
			}

			closeWatch(workspaceCwd);
		},
		stopWatching: closeWatch,
		stopAll() {
			for (const entry of entries.values()) {
				closeEntry(entry);
			}

			entries.clear();
		},
	};
}

/**
 * Default {@link StartWatch}: a recursive watch on the directory, taken the way
 * the running platform can afford.
 *
 * macOS backs `{ recursive: true }` with one FSEvents subscription over the
 * whole tree, so it costs the same whatever the tree holds. Linux has no such
 * primitive and emulates it by registering an inotify watch per entry before
 * the call returns, which blocks the main process for over a second on a
 * workspace with `node_modules` installed — see {@link startLinuxRecursiveWatch}.
 * @param directory - Absolute directory to watch recursively.
 * @param onChange - Called with the changed path, relative to `directory`.
 * @param onError - Called when the underlying watcher errors.
 * @returns A handle whose `close` stops the watch.
 */
function defaultStartWatch(
	directory: string,
	onChange: (changed: string | null) => void,
	onError: () => void,
): WatchHandle {
	if (process.platform === 'linux') {
		return startLinuxRecursiveWatch({
			ignoredDirectoryNames: IGNORED_DIRECTORY_NAMES,
			onChange,
			onError,
			root: directory,
		});
	}

	const watcher = watch(directory, { recursive: true }, (_event, changed) => {
		onChange(changed);
	});
	watcher.on('error', onError);

	return { close: () => watcher.close() };
}

/** True when a change is confined to a directory `git ls-files` never lists. */
function isIgnoredChange(changed: string | null): boolean {
	if (!changed) {
		return false;
	}

	const topSegment = changed.split(/[/\\]/, 1)[0];
	if (IGNORED_DIRECTORY_NAMES.has(topSegment)) {
		return true;
	}

	const basename = changed.split(/[/\\]/).pop() ?? changed;
	return IGNORED_BASENAMES.has(basename) || basename.startsWith('._');
}
