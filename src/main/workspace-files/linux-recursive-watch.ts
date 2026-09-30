import { type Dirent, type WatchEventType, watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { mapWithConcurrency } from '../concurrency/index.ts';
import type { WorkspaceFileEvent } from './workspace-file-changes.ts';

/**
 * Ceiling on the directories one workspace watch may hold. A tree that runs
 * past it keeps the watches it already has and leaves the rest to the
 * renderer's polling fallback, rather than trading a responsive window for
 * freshness on a pathological repository.
 */
const MAX_WATCHED_DIRECTORIES = 4_096;

/**
 * Window over which repeated create/remove events in one directory collapse
 * into a single re-read. A build writing a thousand files into a directory
 * would otherwise cost a `readdir` per file.
 */
const RESCAN_COALESCE_MS = 100;

/**
 * Directory reads one watch keeps in flight. libuv serves `readdir` from a
 * four-thread pool, so reads beyond a handful only queue behind it while each
 * pins its entry array and continuation, which is what fanning out over every
 * directory of a large tree at once costs.
 */
const SCAN_CONCURRENCY = 8;

/** Handle to a running watch; `close` releases every OS watcher it holds. */
export interface LinuxRecursiveWatchHandle {
	close: () => void;
}

/** The part of a directory entry the walk reads. */
type DirectoryEntry = Pick<Dirent, 'isDirectory' | 'name'>;

/** Lists one directory's entries, rejecting when it cannot be read. */
export type ReadDirectory = (
	directory: string,
) => Promise<readonly DirectoryEntry[]>;

/** Opens one OS watch on a directory; `onError` fires when that watch dies. */
export type WatchDirectory = (
	directory: string,
	onEvent: (event: WatchEventType, filename: string | null) => void,
	onError: () => void,
) => { close: () => void };

/** Options for {@link startLinuxRecursiveWatch}. */
export interface LinuxRecursiveWatchOptions {
	/** Directory names never descended into, matched at any depth. */
	ignoredDirectoryNames: ReadonlySet<string>;
	/** Overrides {@link MAX_WATCHED_DIRECTORIES}; exists for tests. */
	maxDirectories?: number;
	/** Receives each event with the path it named, relative to `root`. */
	onChange: (event: WorkspaceFileEvent) => void;
	/** Called when the root's own watch fails, so the caller can drop the entry. */
	onError: () => void;
	/** Overrides the directory read; exists so tests can drive the walk off disk. */
	readDirectory?: ReadDirectory;
	/** Absolute directory at the top of the watched tree. */
	root: string;
	/** Overrides the OS watch; exists so tests can drive the walk off disk. */
	watchDirectory?: WatchDirectory;
}

/**
 * Default {@link ReadDirectory}: one `readdir` reporting entry types.
 * @param directory - Absolute directory to list.
 * @returns The directory's entries.
 */
const readDirectoryFromDisk: ReadDirectory = (directory) =>
	readdir(directory, { withFileTypes: true });

/**
 * Default {@link WatchDirectory}: one non-recursive `fs.watch`.
 * @param directory - Absolute directory to watch.
 * @param onEvent - Called with each OS event and the entry name it named.
 * @param onError - Called when the watch fails.
 * @returns The watcher, whose `close` releases the OS watch.
 */
const watchDirectoryOnDisk: WatchDirectory = (directory, onEvent, onError) => {
	const watcher = watch(directory, (event, filename) => {
		onEvent(event, filename);
	});
	watcher.on('error', onError);

	return watcher;
};

/**
 * Watches a directory tree on Linux by holding one OS watch per directory,
 * skipping the subtrees the file listing never shows.
 *
 * Linux has no kernel primitive for recursive watching, so
 * `fs.watch(dir, { recursive: true })` emulates one: before the call returns it
 * walks the whole tree and registers an inotify watch per *entry*, files
 * included. On a workspace with `node_modules` installed that is ~68,000
 * watches and well over a second of blocked event loop, paid again on every
 * workspace switch — which stalls every pending IPC reply and reads to the user
 * as a frozen window. macOS pays none of it: there one `fs.watch` is a single
 * FSEvents subscription over the whole tree.
 *
 * Directories only, `node_modules` and `.git` never descended into, and the
 * walk runs off the synchronous path, so establishing a watch costs the root's
 * own `fs.watch` and nothing else.
 * @param options - Root, ignore set, change/error callbacks, and the cap.
 * @returns A handle whose `close` releases every watcher in the tree.
 */
export function startLinuxRecursiveWatch({
	ignoredDirectoryNames,
	maxDirectories = MAX_WATCHED_DIRECTORIES,
	onChange,
	onError,
	readDirectory = readDirectoryFromDisk,
	root,
	watchDirectory = watchDirectoryOnDisk,
}: LinuxRecursiveWatchOptions): LinuxRecursiveWatchHandle {
	const watchers = new Map<string, { close: () => void }>();
	const pendingScans = new Map<string, ReturnType<typeof setTimeout>>();
	const queuedScans = new Map<string, boolean>();
	let draining = false;
	let closed = false;

	/**
	 * Reports one OS event with a path relative to the watched root, matching the
	 * shape a native recursive watch hands back.
	 * @param directory - Absolute directory whose watcher fired.
	 * @param kind - The OS event kind.
	 * @param filename - Entry name the OS named, when it named one.
	 */
	const reportChange = (
		directory: string,
		kind: WatchEventType,
		filename: string | null,
	): void => {
		const absolute = filename ? path.join(directory, filename) : directory;

		onChange({ kind, path: path.relative(root, absolute) || null });
	};

	/**
	 * Closes the watcher on a directory and on everything beneath it, along with
	 * any re-read those directories still have queued, for a subtree that was
	 * removed, replaced, or became unreadable.
	 * @param directory - Absolute directory at the top of the branch to drop.
	 */
	const closeBranch = (directory: string): void => {
		const prefix = `${directory}${path.sep}`;

		for (const [watched, watcher] of watchers) {
			if (watched === directory || watched.startsWith(prefix)) {
				watcher.close();
				watchers.delete(watched);
			}
		}

		for (const [pending, timer] of pendingScans) {
			if (pending === directory || pending.startsWith(prefix)) {
				clearTimeout(timer);
				pendingScans.delete(pending);
			}
		}
	};

	/**
	 * Drops watchers for directories that were direct children of `directory`
	 * and are no longer present, so a removed subtree does not keep its watches.
	 * @param directory - Absolute directory that was just re-read.
	 * @param live - Absolute paths of the child directories it still holds.
	 */
	const pruneRemovedChildren = (
		directory: string,
		live: ReadonlySet<string>,
	): void => {
		const prefix = `${directory}${path.sep}`;

		for (const watched of [...watchers.keys()]) {
			if (!watched.startsWith(prefix)) {
				continue;
			}

			const relative = watched.slice(prefix.length);

			if (!relative.includes(path.sep) && !live.has(watched)) {
				closeBranch(watched);
			}
		}
	};

	/**
	 * Adds a watcher for one directory below the root, refusing once the cap is
	 * reached so a huge tree degrades to polling instead of to a stall.
	 * @param directory - Absolute directory to watch.
	 * @returns True when this call established a new watcher.
	 */
	const watchChild = (directory: string): boolean => {
		if (closed || watchers.has(directory) || watchers.size >= maxDirectories) {
			return false;
		}

		try {
			watchers.set(
				directory,
				watchDirectory(
					directory,
					(event, filename) => {
						handleEvent(directory, event, filename);
					},
					() => {
						closeBranch(directory);
					},
				),
			);
		} catch {
			return false;
		}

		return true;
	};

	/**
	 * Reads one directory, watching the child directories it has gained and, when
	 * asked, dropping the ones it has lost.
	 * @param directory - Absolute directory to read.
	 * @param pruneRemoved - Whether children no longer listed may still hold
	 *   watchers. False for a directory this walk only just began watching, which
	 *   cannot have any, so the initial walk never scans every watcher per directory.
	 * @returns The child directories this read started watching, which each still
	 *   need a read of their own.
	 */
	const scan = async (
		directory: string,
		pruneRemoved: boolean,
	): Promise<string[]> => {
		if (closed || !watchers.has(directory)) {
			return [];
		}

		let entries: readonly DirectoryEntry[];

		try {
			entries = await readDirectory(directory);
		} catch {
			if (closed) {
				return [];
			}

			if (directory === root) {
				onError();
			} else {
				closeBranch(directory);
			}

			return [];
		}

		if (closed || !watchers.has(directory)) {
			return [];
		}

		const live = new Set<string>();
		const gained: string[] = [];

		for (const entry of entries) {
			if (!entry.isDirectory() || ignoredDirectoryNames.has(entry.name)) {
				continue;
			}

			const child = path.join(directory, entry.name);
			live.add(child);

			if (watchChild(child)) {
				gained.push(child);
			}
		}

		if (pruneRemoved) {
			pruneRemovedChildren(directory, live);
		}

		return gained;
	};

	/**
	 * Reads queued directories a level at a time, at most {@link SCAN_CONCURRENCY}
	 * at once, until the queue is empty. Only one pass runs per watch, so the
	 * bound holds across the first walk and every event-driven re-read alike.
	 */
	const drainScans = async (): Promise<void> => {
		if (draining) {
			return;
		}

		draining = true;

		try {
			while (!closed && queuedScans.size > 0) {
				const level = [...queuedScans];
				queuedScans.clear();

				const gained = await mapWithConcurrency(
					level,
					SCAN_CONCURRENCY,
					([directory, pruneRemoved]) => scan(directory, pruneRemoved),
				);

				for (const child of gained.flat()) {
					queueScan(child, false);
				}
			}
		} finally {
			draining = false;
		}
	};

	/**
	 * Queues one read of a directory and makes sure a pass is draining the queue.
	 * A directory already queued keeps the stronger of the two prune requests.
	 * @param directory - Absolute directory to read.
	 * @param pruneRemoved - Whether the read must drop children that vanished.
	 */
	const queueScan = (directory: string, pruneRemoved: boolean): void => {
		queuedScans.set(
			directory,
			pruneRemoved || queuedScans.get(directory) === true,
		);
		void drainScans();
	};

	/**
	 * Queues one re-read of a directory whose membership may have changed,
	 * collapsing a burst of events into a single pass.
	 * @param directory - Absolute directory to re-read shortly.
	 */
	const scheduleScan = (directory: string): void => {
		if (closed || pendingScans.has(directory)) {
			return;
		}

		pendingScans.set(
			directory,
			setTimeout(() => {
				pendingScans.delete(directory);
				queueScan(directory, true);
			}, RESCAN_COALESCE_MS),
		);
	};

	/**
	 * Releases the watch on a child a `rename` event named, because that name may
	 * now resolve to a different directory than the one being watched.
	 *
	 * A directory removed and recreated inside one coalesce window keeps its
	 * name, so the re-read alone cannot tell the two apart: it finds the name
	 * present, leaves the watcher in place, and that watcher stays bound to the
	 * deleted inode, which inotify never reports on again. Dropping it here lets
	 * the re-read rebind the name to whatever now holds it.
	 * @param directory - Absolute directory whose watcher fired.
	 * @param filename - Entry name the OS created, removed, or renamed.
	 */
	const dropRenamedChild = (directory: string, filename: string): void => {
		const child = path.join(directory, filename);

		if (watchers.has(child)) {
			closeBranch(child);
		}
	};

	/**
	 * Forwards one watcher event and, when the directory's membership may have
	 * changed, re-reads it so new subdirectories are watched too.
	 * @param directory - Absolute directory whose watcher fired.
	 * @param event - The OS event kind; `rename` covers creation and removal.
	 * @param filename - Entry name the OS named, when it named one.
	 */
	const handleEvent = (
		directory: string,
		event: WatchEventType,
		filename: string | null,
	): void => {
		if (closed) {
			return;
		}

		reportChange(directory, event, filename);

		if (event !== 'rename') {
			return;
		}

		if (filename) {
			dropRenamedChild(directory, filename);
		}

		scheduleScan(directory);
	};

	watchers.set(
		root,
		watchDirectory(
			root,
			(event, filename) => {
				handleEvent(root, event, filename);
			},
			onError,
		),
	);
	queueScan(root, false);

	return {
		close: () => {
			closed = true;

			for (const timer of pendingScans.values()) {
				clearTimeout(timer);
			}

			pendingScans.clear();
			queuedScans.clear();

			for (const watcher of watchers.values()) {
				watcher.close();
			}

			watchers.clear();
		},
	};
}
