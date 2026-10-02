import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	type WatchEventType,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
	type LinuxRecursiveWatchHandle,
	type ReadDirectory,
	startLinuxRecursiveWatch,
	type WatchDirectory,
} from '../../src/main/workspace-files/linux-recursive-watch';
import { createWorkspaceFilesWatcher } from '../../src/main/workspace-files/watch-workspace-files';
import type { WorkspaceFileEvent } from '../../src/main/workspace-files/workspace-file-changes';

const IGNORED = new Set(['.git', 'node_modules']);
// inotify delivers on the next loop turns; the walk that adds a new directory's
// watch is async on top of that.
const SETTLE_MS = 400;

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `predicate` holds or the budget runs out, polling every 25ms. */
async function waitFor(
	predicate: () => boolean,
	budgetMs = 3_000,
): Promise<void> {
	const deadline = Date.now() + budgetMs;

	while (Date.now() < deadline) {
		if (predicate()) {
			return;
		}

		await sleep(25);
	}
}

// `defaultStartWatch` reaches `startLinuxRecursiveWatch` only when
// `process.platform === 'linux'`; every other platform takes `fs.watch(dir,
// { recursive: true })` directly. Driving this module through FSEvents on macOS
// therefore asserts a path production never takes there, and it does it against
// a wall clock: the budget below is sized for inotify's next-loop-turn
// delivery, while FSEvents coalesces, so a loaded CI runner turns the suite red
// for a reason unrelated to the diff under test.
describe.skipIf(process.platform !== 'linux')(
	'startLinuxRecursiveWatch',
	() => {
		let root: string;
		let handle: LinuxRecursiveWatchHandle | null = null;
		let changes: (string | null)[] = [];
		let errors = 0;

		beforeEach(() => {
			root = mkdtempSync(path.join(tmpdir(), 'ensemblr-watch-'));
			changes = [];
			errors = 0;
		});

		afterEach(() => {
			handle?.close();
			handle = null;
			rmSync(root, { force: true, recursive: true });
		});

		/** Starts a watch on the temp root, recording changes and errors. */
		function start(maxDirectories?: number): LinuxRecursiveWatchHandle {
			handle = startLinuxRecursiveWatch({
				ignoredDirectoryNames: IGNORED,
				...(maxDirectories === undefined ? {} : { maxDirectories }),
				onChange: (event) => {
					changes.push(event.path);
				},
				onError: () => {
					errors += 1;
				},
				root,
			});

			return handle;
		}

		test('reports a nested change as a path relative to the root', async () => {
			mkdirSync(path.join(root, 'src', 'renderer'), { recursive: true });
			start();
			await sleep(SETTLE_MS);
			changes = [];

			writeFileSync(path.join(root, 'src', 'renderer', 'app.ts'), 'x');
			await waitFor(() =>
				changes.includes(path.join('src', 'renderer', 'app.ts')),
			);

			expect(changes).toContain(path.join('src', 'renderer', 'app.ts'));
		});

		test('never descends into an ignored directory', async () => {
			mkdirSync(path.join(root, 'node_modules', 'react'), { recursive: true });
			mkdirSync(path.join(root, '.git', 'objects'), { recursive: true });
			mkdirSync(path.join(root, 'src'), { recursive: true });
			start();
			await sleep(SETTLE_MS);
			changes = [];

			writeFileSync(path.join(root, 'node_modules', 'react', 'index.js'), 'x');
			writeFileSync(path.join(root, '.git', 'objects', 'pack'), 'x');
			await sleep(SETTLE_MS);

			expect(changes).toEqual([]);
		});

		test('watches a directory created after the walk finished', async () => {
			mkdirSync(path.join(root, 'src'), { recursive: true });
			start();
			await sleep(SETTLE_MS);

			mkdirSync(path.join(root, 'src', 'state'), { recursive: true });
			await sleep(SETTLE_MS);
			changes = [];

			writeFileSync(path.join(root, 'src', 'state', 'atoms.ts'), 'x');
			await waitFor(() =>
				changes.includes(path.join('src', 'state', 'atoms.ts')),
			);

			expect(changes).toContain(path.join('src', 'state', 'atoms.ts'));
		});

		// A `git checkout` that drops a directory and one that restores it land well
		// inside the coalesce window, so the re-read sees the name the whole time and
		// cannot tell the watcher is bound to the deleted inode.
		test('rewatches a directory removed and recreated in one window', async () => {
			mkdirSync(path.join(root, 'dist', 'assets'), { recursive: true });
			start();
			await sleep(SETTLE_MS);

			rmSync(path.join(root, 'dist'), { force: true, recursive: true });
			mkdirSync(path.join(root, 'dist', 'assets'), { recursive: true });
			await sleep(SETTLE_MS);
			changes = [];

			writeFileSync(path.join(root, 'dist', 'assets', 'app.js'), 'x');
			await waitFor(() =>
				changes.includes(path.join('dist', 'assets', 'app.js')),
			);

			expect(changes).toContain(path.join('dist', 'assets', 'app.js'));
		});

		test('stops reporting once closed', async () => {
			mkdirSync(path.join(root, 'src'), { recursive: true });
			start();
			await sleep(SETTLE_MS);

			handle?.close();
			handle = null;
			changes = [];

			writeFileSync(path.join(root, 'src', 'app.ts'), 'x');
			await sleep(SETTLE_MS);

			expect(changes).toEqual([]);
		});

		test('reports the root disappearing as an error', async () => {
			start();
			await sleep(SETTLE_MS);

			rmSync(root, { force: true, recursive: true });
			await waitFor(() => errors > 0);

			expect(errors).toBeGreaterThan(0);
			mkdirSync(root, { recursive: true });
		});

		test('stops adding watches once the cap is reached', async () => {
			for (let index = 0; index < 6; index += 1) {
				mkdirSync(path.join(root, `dir-${index}`, 'nested'), {
					recursive: true,
				});
			}
			start(2);
			await sleep(SETTLE_MS);
			changes = [];

			for (let index = 0; index < 6; index += 1) {
				writeFileSync(path.join(root, `dir-${index}`, 'nested', 'f.ts'), 'x');
			}
			await sleep(SETTLE_MS);

			expect(changes).toEqual([]);
		});

		// The regression this guards is invisible behaviourally: `fs.watch` with
		// `{ recursive: true }` reports the same events, it just registers one
		// inotify watch per entry to do it. Count them.
		test('the default workspace watch holds a watch per directory, not per entry', async () => {
			mkdirSync(path.join(root, 'src'), { recursive: true });
			for (let index = 0; index < 50; index += 1) {
				const packageDir = path.join(root, 'node_modules', `pkg-${index}`);
				mkdirSync(packageDir, { recursive: true });
				writeFileSync(path.join(packageDir, 'index.js'), 'x');
			}
			const notified: string[] = [];
			const watcher = createWorkspaceFilesWatcher({
				onChange: (cwd) => notified.push(cwd),
			});
			const before = inotifyWatchCount();

			watcher.watch(root);
			await sleep(SETTLE_MS);
			const added = inotifyWatchCount() - before;

			writeFileSync(path.join(root, 'src', 'app.ts'), 'x');
			await waitFor(() => notified.length > 0);
			writeFileSync(path.join(root, 'node_modules', 'pkg-0', 'index.js'), 'y');
			await sleep(SETTLE_MS);
			watcher.stopAll();

			expect(added).toBeLessThanOrEqual(10);
			expect(notified).toEqual([root]);
		});
	},
);

interface FakeEntry {
	isDirectory: () => boolean;
	name: string;
}

type FakeTree = Record<string, readonly FakeEntry[]>;

interface FakeDisk {
	closed: Set<string>;
	emit: (
		directory: string,
		event: WatchEventType,
		filename: string | null,
	) => void;
	errors: number;
	failing: Set<string>;
	gated: boolean;
	held: (() => void)[];
	inFlight: number;
	opened: string[];
	peakInFlight: number;
	readDirectory: ReadDirectory;
	reads: string[];
	release: () => void;
	tree: FakeTree;
	watchDirectory: WatchDirectory;
}

const FAKE_ROOT = path.join(path.sep, 'fake', 'root');

/** Absolute path of an entry beneath the fake root. */
const at = (...segments: string[]): string => path.join(FAKE_ROOT, ...segments);

/** A directory entry as `readdir` reports it, or a file with `isDirectory` false. */
const entry = (name: string, isDirectory = true): FakeEntry => ({
	isDirectory: () => isDirectory,
	name,
});

/** A root of `width` directories, each holding one nested directory and one file. */
function wideTree(width: number): FakeTree {
	const names = Array.from({ length: width }, (_, index) => `dir-${index}`);

	return {
		[FAKE_ROOT]: names.map((name) => entry(name)),
		...Object.fromEntries(
			names.map((name) => [
				at(name),
				[entry('nested'), entry('file.ts', false)],
			]),
		),
	};
}

/**
 * An in-memory stand-in for the directory reads and OS watches the walk makes.
 * Reads either finish on the next microtask or, once `gated`, stay in flight
 * until `release`, which is how a test freezes the walk part-way.
 */
function createFakeDisk(tree: FakeTree): FakeDisk {
	const listeners = new Map<
		string,
		(event: WatchEventType, filename: string | null) => void
	>();
	const disk: FakeDisk = {
		closed: new Set(),
		emit: (directory, event, filename) => {
			listeners.get(directory)?.(event, filename);
		},
		errors: 0,
		failing: new Set(),
		gated: false,
		held: [],
		inFlight: 0,
		opened: [],
		peakInFlight: 0,
		readDirectory: async (directory) => {
			disk.reads.push(directory);
			disk.inFlight += 1;
			disk.peakInFlight = Math.max(disk.peakInFlight, disk.inFlight);

			try {
				await new Promise<void>((resolve) => {
					if (disk.gated) {
						disk.held.push(resolve);
					} else {
						resolve();
					}
				});

				if (disk.failing.has(directory)) {
					throw new Error(`EACCES: ${directory}`);
				}

				return disk.tree[directory] ?? [];
			} finally {
				disk.inFlight -= 1;
			}
		},
		reads: [],
		release: () => {
			for (const resolve of disk.held.splice(0)) {
				resolve();
			}
		},
		tree,
		watchDirectory: (directory, onEvent) => {
			disk.opened.push(directory);
			listeners.set(directory, onEvent);

			return {
				close: () => {
					disk.closed.add(directory);
				},
			};
		},
	};

	return disk;
}

/**
 * Lets every promise the walk has queued run. The fake disk never waits on a
 * timer, so a macrotask boundary is enough for the walk to reach its next await.
 */
const settle = (): Promise<void> => sleep(0);

/** Releases gated reads round after round until the walk has nothing left in flight. */
async function runToCompletion(disk: FakeDisk): Promise<void> {
	await settle();

	for (let round = 0; round < 500 && disk.held.length > 0; round += 1) {
		disk.release();
		await settle();
	}
}

// The seams replace `readdir` and `fs.watch`, so this suite drives the walk on
// every platform and needs no inotify or wall-clock budget.
describe('startLinuxRecursiveWatch walk', () => {
	let handle: LinuxRecursiveWatchHandle | null = null;

	afterEach(() => {
		handle?.close();
		handle = null;
	});

	/** Starts a watch over the fake root, counting root errors on the disk. */
	function start(disk: FakeDisk): LinuxRecursiveWatchHandle {
		handle = startLinuxRecursiveWatch({
			ignoredDirectoryNames: IGNORED,
			onChange: () => undefined,
			onError: () => {
				disk.errors += 1;
			},
			readDirectory: disk.readDirectory,
			root: FAKE_ROOT,
			watchDirectory: disk.watchDirectory,
		});

		return handle;
	}

	test('reports each event with its kind and its path relative to the root', async () => {
		const disk = createFakeDisk({ [FAKE_ROOT]: [entry('src')] });
		const events: WorkspaceFileEvent[] = [];
		handle = startLinuxRecursiveWatch({
			ignoredDirectoryNames: IGNORED,
			onChange: (event) => {
				events.push(event);
			},
			onError: () => undefined,
			readDirectory: disk.readDirectory,
			root: FAKE_ROOT,
			watchDirectory: disk.watchDirectory,
		});
		await runToCompletion(disk);

		disk.emit(at('src'), 'change', 'app.ts');
		disk.emit(FAKE_ROOT, 'rename', 'README.md');
		disk.emit(FAKE_ROOT, 'change', null);

		expect(events).toEqual([
			{ kind: 'change', path: path.join('src', 'app.ts') },
			{ kind: 'rename', path: 'README.md' },
			{ kind: 'change', path: null },
		]);
	});

	test('keeps at most eight directory reads in flight across a wide tree', async () => {
		const disk = createFakeDisk(wideTree(50));

		start(disk);
		await runToCompletion(disk);

		expect(disk.peakInFlight).toBeLessThanOrEqual(8);
		expect(disk.peakInFlight).toBeGreaterThan(1);
		expect(disk.reads).toHaveLength(1 + 50 + 50);
	});

	test('watches every eligible directory and reads no ignored one', async () => {
		const disk = createFakeDisk({
			[FAKE_ROOT]: [
				entry('src'),
				entry('node_modules'),
				entry('.git'),
				entry('README.md', false),
			],
			[at('src')]: [
				entry('components'),
				entry('state'),
				entry('index.ts', false),
			],
			[at('src', 'components')]: [entry('ui')],
			[at('node_modules')]: [entry('react')],
			[at('.git')]: [entry('objects')],
		});

		start(disk);
		await runToCompletion(disk);

		expect([...disk.opened].sort()).toEqual(
			[
				FAKE_ROOT,
				at('src'),
				at('src', 'components'),
				at('src', 'components', 'ui'),
				at('src', 'state'),
			].sort(),
		);
		expect(disk.reads).not.toContain(at('node_modules'));
		expect(disk.reads).not.toContain(at('.git'));
	});

	test('stops reading and watching once closed part-way through the walk', async () => {
		const disk = createFakeDisk(wideTree(50));
		disk.gated = true;

		start(disk);
		await settle();
		disk.release();
		await settle();
		expect(disk.inFlight).toBeGreaterThan(0);
		const readsAtClose = disk.reads.length;
		const opened = [...disk.opened];

		handle?.close();
		await runToCompletion(disk);

		expect(disk.reads).toHaveLength(readsAtClose);
		expect(disk.opened).toEqual(opened);
		expect([...disk.closed].sort()).toEqual([...opened].sort());
	});

	test('does not report a root read that fails after the watch closed', async () => {
		const disk = createFakeDisk({ [FAKE_ROOT]: [] });
		disk.gated = true;
		disk.failing.add(FAKE_ROOT);

		start(disk);
		await settle();
		handle?.close();
		await runToCompletion(disk);

		expect(disk.errors).toBe(0);
	});

	test('reports a root that cannot be read and descends into nothing', async () => {
		const disk = createFakeDisk(wideTree(3));
		disk.failing.add(FAKE_ROOT);

		start(disk);
		await runToCompletion(disk);

		expect(disk.errors).toBe(1);
		expect(disk.opened).toEqual([FAKE_ROOT]);
	});

	test('a directory that cannot be read loses its own branch and nothing else', async () => {
		const disk = createFakeDisk({
			[FAKE_ROOT]: [entry('a'), entry('b'), entry('c')],
			[at('a')]: [entry('a1')],
			[at('b')]: [entry('b1')],
			[at('c')]: [entry('c1')],
		});
		disk.failing.add(at('b'));

		start(disk);
		await runToCompletion(disk);

		expect([...disk.closed]).toEqual([at('b')]);
		expect(disk.opened).toEqual(
			expect.arrayContaining([at('a', 'a1'), at('c', 'c1')]),
		);
		expect(disk.opened).not.toContain(at('b', 'b1'));
		expect(disk.errors).toBe(0);
	});

	test('holds event-driven rescans to the same bound as the first walk', async () => {
		const names = Array.from({ length: 12 }, (_, index) => `dir-${index}`);
		const disk = createFakeDisk({
			[FAKE_ROOT]: names.map((name) => entry(name)),
			...Object.fromEntries(names.map((name) => [at(name), [entry('x')]])),
		});
		disk.gated = true;

		start(disk);
		await settle();
		disk.release();
		await settle();

		for (const name of names.slice(8)) {
			disk.emit(at(name), 'rename', 'created');
		}
		await sleep(150);
		await runToCompletion(disk);

		expect(disk.peakInFlight).toBeLessThanOrEqual(8);
	});

	test('a rescan drops watches on directories that vanished and adds new ones', async () => {
		const disk = createFakeDisk({
			[FAKE_ROOT]: [entry('keep'), entry('gone')],
			[at('gone')]: [entry('deep')],
		});

		start(disk);
		await runToCompletion(disk);
		disk.tree = { [FAKE_ROOT]: [entry('keep'), entry('fresh')] };
		disk.emit(FAKE_ROOT, 'rename', 'unrelated');
		await sleep(150);
		await runToCompletion(disk);

		expect([...disk.closed].sort()).toEqual(
			[at('gone'), at('gone', 'deep')].sort(),
		);
		expect(disk.opened).toContain(at('fresh'));
	});
});

/** Counts the inotify watches this process holds, across every inotify fd. */
function inotifyWatchCount(): number {
	let total = 0;

	for (const fd of readdirSync(`/proc/${process.pid}/fd`)) {
		try {
			if (
				readlinkSync(`/proc/${process.pid}/fd/${fd}`) === 'anon_inode:inotify'
			) {
				total += readFileSync(`/proc/${process.pid}/fdinfo/${fd}`, 'utf8')
					.split('\n')
					.filter((line) => line.startsWith('inotify')).length;
			}
		} catch {
			// A descriptor the process closed between readdir and readlink.
		}
	}

	return total;
}
