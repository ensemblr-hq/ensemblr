import { type Dirent, type FSWatcher, watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

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

/** Handle to a running watch; `close` releases every OS watcher it holds. */
export interface LinuxRecursiveWatchHandle {
	close: () => void;
}

/** Options for {@link startLinuxRecursiveWatch}. */
export interface LinuxRecursiveWatchOptions {
	/** Directory names never descended into, matched at any depth. */
	ignoredDirectoryNames: ReadonlySet<string>;
	/** Overrides {@link MAX_WATCHED_DIRECTORIES}; exists for tests. */
	maxDirectories?: number;
	/** Receives each change as a path relative to `root`. */
	onChange: (changed: string | null) => void;
	/** Called when the root's own watch fails, so the caller can drop the entry. */
	onError: () => void;
	/** Absolute directory at the top of the watched tree. */
	root: string;
}

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
	root,
}: LinuxRecursiveWatchOptions): LinuxRecursiveWatchHandle {
	const watchers = new Map<string, FSWatcher>();
	const pendingScans = new Map<string, ReturnType<typeof setTimeout>>();
	let closed = false;

	/**
	 * Reports one OS event as a path relative to the watched root, matching the
	 * shape a native recursive watch hands back.
	 * @param directory - Absolute directory whose watcher fired.
	 * @param filename - Entry name the OS named, when it named one.
	 */
	const reportChange = (directory: string, filename: string | null): void => {
		const absolute = filename ? path.join(directory, filename) : directory;

		onChange(path.relative(root, absolute) || null);
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
			const watcher = watch(directory, (event, filename) => {
				handleEvent(directory, event, filename);
			});
			watcher.on('error', () => {
				closeBranch(directory);
			});
			watchers.set(directory, watcher);
		} catch {
			return false;
		}

		return true;
	};

	/**
	 * Re-reads one directory, watching child directories it has gained and
	 * dropping those it has lost, then descends into the new ones.
	 * @param directory - Absolute directory to re-read.
	 */
	const scan = async (directory: string): Promise<void> => {
		let entries: Dirent[];

		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch {
			if (directory === root) {
				onError();
			} else {
				closeBranch(directory);
			}

			return;
		}

		if (closed) {
			return;
		}

		const live = new Set<string>();
		const descend: string[] = [];

		for (const entry of entries) {
			if (!entry.isDirectory() || ignoredDirectoryNames.has(entry.name)) {
				continue;
			}

			const child = path.join(directory, entry.name);
			live.add(child);

			if (watchChild(child)) {
				descend.push(child);
			}
		}

		pruneRemovedChildren(directory, live);
		await Promise.all(descend.map((child) => scan(child)));
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
				void scan(directory);
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
		event: string,
		filename: string | null,
	): void => {
		if (closed) {
			return;
		}

		reportChange(directory, filename);

		if (event !== 'rename') {
			return;
		}

		if (filename) {
			dropRenamedChild(directory, filename);
		}

		scheduleScan(directory);
	};

	const rootWatcher = watch(root, (event, filename) => {
		handleEvent(root, event, filename);
	});
	rootWatcher.on('error', onError);
	watchers.set(root, rootWatcher);
	void scan(root);

	return {
		close: () => {
			closed = true;

			for (const timer of pendingScans.values()) {
				clearTimeout(timer);
			}

			pendingScans.clear();

			for (const watcher of watchers.values()) {
				watcher.close();
			}

			watchers.clear();
		},
	};
}
