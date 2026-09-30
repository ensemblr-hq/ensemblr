import { watch } from 'node:fs';
import path from 'node:path';

import type { WorkspaceFilesChangeFlags } from '../../shared/ipc/contracts/workspace-files';
import { startLinuxRecursiveWatch } from './linux-recursive-watch.ts';
import {
	classifyWorkspaceFileEvent,
	IGNORED_DIRECTORY_NAMES,
	isIgnoredChange,
	mergeFileChangeFlags,
	NO_FILE_CHANGES,
	type WorkspaceFileEvent,
} from './workspace-file-changes.ts';

const WATCH_DEBOUNCE_MS = 250;
/**
 * Ceiling on how long a burst of events may defer the notification. The debounce
 * alone is trailing-only, so sustained churn — an `npm install`, a build, moving
 * a large directory — restarts it forever and the renderer never hears until the
 * 30s poll (which pauses entirely while the window is blurred).
 */
const WATCH_MAX_WAIT_MS = 1_000;

/** Handle to a single OS watch; `close` releases it. */
interface WatchHandle {
	close: () => void;
}

/**
 * Starts one recursive directory watch. Abstracted so tests can drive synthetic
 * change/error events without touching the real filesystem.
 * @param directory - Absolute directory to watch recursively.
 * @param onChange - Called with each event, its path relative to `directory`.
 * @param onError - Called when the underlying watcher errors.
 * @returns A handle whose `close` stops the watch.
 */
export type StartWatch = (
	directory: string,
	onChange: (event: WorkspaceFileEvent) => void,
	onError: () => void,
) => WatchHandle;

/**
 * Internal per-directory watch state: OS handle, debounce timer, the start of the
 * current burst (for the max-wait clamp), what the burst has raised so far, and
 * reference count.
 */
interface WatchEntry {
	burstStartedAt: number | null;
	debounce: ReturnType<typeof setTimeout> | null;
	handle: WatchHandle;
	pending: WorkspaceFilesChangeFlags;
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
	/**
	 * Notified (debounced, per cwd) when a non-ignored file change is seen, with
	 * what every event in the burst may have changed.
	 */
	onChange: (workspaceCwd: string, changes: WorkspaceFilesChangeFlags) => void;
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

	/**
	 * Folds one event into its directory's burst and (re)arms the debounce that
	 * delivers the burst, so a burst is announced once with everything it raised.
	 * @param workspaceCwd - Absolute path of the watched directory.
	 * @param changes - Flags the event raised.
	 */
	const scheduleChange = (
		workspaceCwd: string,
		changes: WorkspaceFilesChangeFlags,
	): void => {
		const entry = entries.get(workspaceCwd);

		if (!entry) {
			return;
		}

		entry.pending = mergeFileChangeFlags(entry.pending, changes);

		if (entry.debounce) {
			clearTimeout(entry.debounce);
		}

		entry.burstStartedAt ??= Date.now();
		const elapsed = Date.now() - entry.burstStartedAt;
		const delay = Math.max(
			0,
			Math.min(WATCH_DEBOUNCE_MS, WATCH_MAX_WAIT_MS - elapsed),
		);

		entry.debounce = setTimeout(() => {
			const burst = entry.pending;

			entry.debounce = null;
			entry.burstStartedAt = null;
			entry.pending = NO_FILE_CHANGES;
			onChange(workspaceCwd, burst);
		}, delay);
	};

	const closeEntry = (entry: WatchEntry): void => {
		if (entry.debounce) {
			clearTimeout(entry.debounce);
			entry.debounce = null;
		}

		entry.burstStartedAt = null;
		entry.pending = NO_FILE_CHANGES;
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
					(event) => {
						if (!isIgnoredChange(event.path)) {
							scheduleChange(workspaceCwd, classifyWorkspaceFileEvent(event));
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

			entries.set(workspaceCwd, {
				burstStartedAt: null,
				debounce: null,
				handle,
				pending: NO_FILE_CHANGES,
				refCount: 1,
			});
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
 * @param onChange - Called with each event, its path relative to `directory`.
 * @param onError - Called when the underlying watcher errors.
 * @returns A handle whose `close` stops the watch.
 */
function defaultStartWatch(
	directory: string,
	onChange: (event: WorkspaceFileEvent) => void,
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

	const watcher = watch(directory, { recursive: true }, (kind, changed) => {
		onChange({ kind, path: changed });
	});
	watcher.on('error', onError);

	return { close: () => watcher.close() };
}
