import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
	type LinuxRecursiveWatchHandle,
	startLinuxRecursiveWatch,
} from '../../src/main/workspace-files/linux-recursive-watch';
import { createWorkspaceFilesWatcher } from '../../src/main/workspace-files/watch-workspace-files';

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

describe('startLinuxRecursiveWatch', () => {
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
			onChange: (changed) => {
				changes.push(changed);
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
			mkdirSync(path.join(root, `dir-${index}`, 'nested'), { recursive: true });
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
	test.skipIf(process.platform !== 'linux')(
		'the default workspace watch holds a watch per directory, not per entry',
		async () => {
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
		},
	);
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
