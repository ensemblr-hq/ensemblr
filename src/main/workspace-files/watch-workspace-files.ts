import { watch } from 'node:fs';
import path from 'node:path';

const WATCH_DEBOUNCE_MS = 250;

/**
 * First path segments whose churn never changes `git ls-files` output but would
 * otherwise trigger refetch storms — `.git` rewrites itself on every git
 * command, and `node_modules` is gitignored in practice. Ignoring them keeps
 * the watcher quiet; the renderer's polling fallback still covers the rare repo
 * that tracks these paths.
 */
const IGNORED_TOP_SEGMENTS = new Set(['.git', 'node_modules']);

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

interface WatchEntry {
	debounce: ReturnType<typeof setTimeout> | null;
	handle: WatchHandle;
	refCount: number;
}

export interface WorkspaceFilesWatcher {
	/** Begin (or ref-count) watching a workspace directory for file changes. */
	watch: (workspaceCwd: string) => void;
	/** Drop one watch reference; closes the OS watcher once it reaches zero. */
	unwatch: (workspaceCwd: string) => void;
	/** Closes every watcher and pending timer; call on app quit. */
	stopAll: () => void;
}

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
						const current = entries.get(workspaceCwd);

						if (current) {
							closeEntry(current);
							entries.delete(workspaceCwd);
						}
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

			closeEntry(entry);
			entries.delete(workspaceCwd);
		},
		stopAll() {
			for (const entry of entries.values()) {
				closeEntry(entry);
			}

			entries.clear();
		},
	};
}

/** Default {@link StartWatch}: a recursive `fs.watch` on the directory. */
function defaultStartWatch(
	directory: string,
	onChange: (changed: string | null) => void,
	onError: () => void,
): WatchHandle {
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
	return IGNORED_TOP_SEGMENTS.has(topSegment);
}
