import type { WatchEventType } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';

import { WORKTREE_INCLUDE_FILENAME } from '../../src/main/config/repository-config-loaders';
import { ENSEMBLR_DIRECTORY } from '../../src/main/config/repository-paths';
import {
	createWorkspaceFilesWatcher,
	type StartWatch,
} from '../../src/main/workspace-files/watch-workspace-files';
import type { WorkspaceFilesChangeFlags } from '../../src/shared/ipc/contracts/workspace-files';

// The watcher debounces at 250ms; wait past that before asserting.
const AFTER_DEBOUNCE_MS = 320;

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

interface FakeWatch {
	changed: (changed: string | null, kind?: WatchEventType) => void;
	closed: boolean;
	directory: string;
	errored: () => void;
}

/** A {@link StartWatch} that records watches and lets tests fire/close them. */
function fakeWatchFactory(): { startWatch: StartWatch; watches: FakeWatch[] } {
	const watches: FakeWatch[] = [];
	const startWatch: StartWatch = (directory, onChange, onError) => {
		const record: FakeWatch = {
			changed: (changed, kind = 'change') => {
				onChange({ kind, path: changed });
			},
			closed: false,
			directory,
			errored: onError,
		};
		watches.push(record);
		return {
			close: () => {
				record.closed = true;
			},
		};
	};
	return { startWatch, watches };
}

describe('createWorkspaceFilesWatcher', () => {
	test('emits a debounced change for the watched cwd', async () => {
		const changes: string[] = [];
		const { startWatch, watches } = fakeWatchFactory();
		const watcher = createWorkspaceFilesWatcher({
			onChange: (cwd) => changes.push(cwd),
			startWatch,
		});

		watcher.watch('/abs/workspace');
		expect(watches).toHaveLength(1);
		watches[0].changed('src/app.ts');
		watches[0].changed('src/other.ts');

		expect(changes).toEqual([]);
		await sleep(AFTER_DEBOUNCE_MS);
		expect(changes).toEqual(['/abs/workspace']);
	});

	// Fake timers rather than `sleep`: the window between the max-wait firing at
	// 1s and the following burst's trailing debounce at 1.35s is ~150ms of real
	// clock, which a loaded parallel runner can drift straight through.
	test('fires under sustained churn instead of starving the debounce', () => {
		vi.useFakeTimers();
		try {
			const changes: string[] = [];
			const { startWatch, watches } = fakeWatchFactory();
			const watcher = createWorkspaceFilesWatcher({
				onChange: (cwd) => changes.push(cwd),
				startWatch,
			});

			watcher.watch('/abs/workspace');
			// Events closer together than the 250ms debounce restart it every time,
			// so without the 1s max-wait this burst would never notify.
			for (let index = 0; index < 12; index += 1) {
				watches[0].changed(`src/file-${index}.ts`);
				vi.advanceTimersByTime(100);
			}

			expect(changes).toEqual(['/abs/workspace']);

			// The max-wait ends the burst rather than the watch: events after it
			// start a fresh one, which still owes its own trailing notification.
			vi.advanceTimersByTime(AFTER_DEBOUNCE_MS);
			expect(changes).toEqual(['/abs/workspace', '/abs/workspace']);
		} finally {
			vi.useRealTimers();
		}
	});

	test('ignores .git and node_modules churn', async () => {
		const changes: string[] = [];
		const { startWatch, watches } = fakeWatchFactory();
		const watcher = createWorkspaceFilesWatcher({
			onChange: (cwd) => changes.push(cwd),
			startWatch,
		});

		watcher.watch('/abs/workspace');
		watches[0].changed('.git/index');
		watches[0].changed('node_modules/react/index.js');

		await sleep(AFTER_DEBOUNCE_MS);
		expect(changes).toEqual([]);
	});

	test('ignores .git and node_modules churn at any depth', async () => {
		const changes: string[] = [];
		const { startWatch, watches } = fakeWatchFactory();
		const watcher = createWorkspaceFilesWatcher({
			onChange: (cwd) => changes.push(cwd),
			startWatch,
		});

		watcher.watch('/abs/workspace');
		watches[0].changed('packages/web/node_modules/react/index.js');
		watches[0].changed('packages/web/.git/index');
		watches[0].changed('vendor\\pkg\\node_modules\\lib.js');

		await sleep(AFTER_DEBOUNCE_MS);
		expect(changes).toEqual([]);
	});

	test('still emits for a path whose segment merely contains an ignored name', async () => {
		const changes: string[] = [];
		const { startWatch, watches } = fakeWatchFactory();
		const watcher = createWorkspaceFilesWatcher({
			onChange: (cwd) => changes.push(cwd),
			startWatch,
		});

		watcher.watch('/abs/workspace');
		watches[0].changed('docs/node_modules-guide/index.md');

		await sleep(AFTER_DEBOUNCE_MS);
		expect(changes).toEqual(['/abs/workspace']);
	});

	test('ignores .DS_Store and AppleDouble churn at any depth', async () => {
		const changes: string[] = [];
		const { startWatch, watches } = fakeWatchFactory();
		const watcher = createWorkspaceFilesWatcher({
			onChange: (cwd) => changes.push(cwd),
			startWatch,
		});

		watcher.watch('/abs/workspace');
		watches[0].changed('.DS_Store');
		watches[0].changed('src/components/.DS_Store');
		watches[0].changed('src/._app.ts');

		await sleep(AFTER_DEBOUNCE_MS);
		expect(changes).toEqual([]);
	});

	test('rejects a relative cwd without starting a watch', () => {
		const { startWatch, watches } = fakeWatchFactory();
		const watcher = createWorkspaceFilesWatcher({
			onChange: () => undefined,
			startWatch,
		});

		watcher.watch('relative/path');
		expect(watches).toHaveLength(0);
	});

	test('ref-counts so one cwd shares a single OS watch', async () => {
		const changes: string[] = [];
		const { startWatch, watches } = fakeWatchFactory();
		const watcher = createWorkspaceFilesWatcher({
			onChange: (cwd) => changes.push(cwd),
			startWatch,
		});

		watcher.watch('/abs/workspace');
		watcher.watch('/abs/workspace');
		expect(watches).toHaveLength(1);

		// One unwatch keeps the watch alive (refCount still > 0).
		watcher.unwatch('/abs/workspace');
		expect(watches[0].closed).toBe(false);
		watches[0].changed('src/a.ts');
		await sleep(AFTER_DEBOUNCE_MS);
		expect(changes).toEqual(['/abs/workspace']);

		// The final unwatch closes the OS watch and stops further notifications.
		watcher.unwatch('/abs/workspace');
		expect(watches[0].closed).toBe(true);
		watches[0].changed('src/b.ts');
		await sleep(AFTER_DEBOUNCE_MS);
		expect(changes).toEqual(['/abs/workspace']);
	});

	// A workspace open in two windows holds two references, so the `unwatch` the
	// removal could issue would leave the OS watching a directory being unlinked.
	test('stopWatching closes the OS watch whatever the reference count', async () => {
		const changes: string[] = [];
		const { startWatch, watches } = fakeWatchFactory();
		const watcher = createWorkspaceFilesWatcher({
			onChange: (cwd) => changes.push(cwd),
			startWatch,
		});

		watcher.watch('/abs/workspace');
		watcher.watch('/abs/workspace');

		watcher.stopWatching('/abs/workspace');

		expect(watches[0].closed).toBe(true);
		watches[0].changed('src/a.ts');
		await sleep(AFTER_DEBOUNCE_MS);
		expect(changes).toEqual([]);
	});

	test('stopWatching leaves other workspaces watched', () => {
		const { startWatch, watches } = fakeWatchFactory();
		const watcher = createWorkspaceFilesWatcher({
			onChange: () => undefined,
			startWatch,
		});

		watcher.watch('/abs/one');
		watcher.watch('/abs/two');

		watcher.stopWatching('/abs/one');

		expect(watches[0].closed).toBe(true);
		expect(watches[1].closed).toBe(false);
	});

	test('stopWatching an unwatched cwd is a no-op', () => {
		const { startWatch, watches } = fakeWatchFactory();
		const watcher = createWorkspaceFilesWatcher({
			onChange: () => undefined,
			startWatch,
		});

		expect(() => watcher.stopWatching('/abs/never-watched')).not.toThrow();
		expect(watches).toHaveLength(0);
	});

	// stopWatching drops the entry outright, so the next watch() has to establish
	// a fresh OS watch rather than resurrect a closed one.
	test('a watch after stopWatching starts a new OS watch', async () => {
		const changes: string[] = [];
		const { startWatch, watches } = fakeWatchFactory();
		const watcher = createWorkspaceFilesWatcher({
			onChange: (cwd) => changes.push(cwd),
			startWatch,
		});

		watcher.watch('/abs/workspace');
		watcher.stopWatching('/abs/workspace');
		watcher.watch('/abs/workspace');

		expect(watches).toHaveLength(2);
		expect(watches[1].closed).toBe(false);
		watches[1].changed('src/a.ts');
		await sleep(AFTER_DEBOUNCE_MS);
		expect(changes).toEqual(['/abs/workspace']);
	});

	test('drops the entry when the watcher errors', () => {
		const { startWatch, watches } = fakeWatchFactory();
		const watcher = createWorkspaceFilesWatcher({
			onChange: () => undefined,
			startWatch,
		});

		watcher.watch('/abs/workspace');
		watches[0].errored();
		expect(watches[0].closed).toBe(true);

		// Re-watching establishes a fresh OS watch rather than reusing the dropped one.
		watcher.watch('/abs/workspace');
		expect(watches).toHaveLength(2);
		expect(watches[1].closed).toBe(false);
	});

	test('stopAll closes every active watch', () => {
		const { startWatch, watches } = fakeWatchFactory();
		const watcher = createWorkspaceFilesWatcher({
			onChange: () => undefined,
			startWatch,
		});

		watcher.watch('/abs/one');
		watcher.watch('/abs/two');
		watcher.stopAll();

		expect(watches.map((entry) => entry.closed)).toEqual([true, true]);
	});

	test('coalesces a rapid burst into a single notification', async () => {
		const changes: string[] = [];
		const { startWatch, watches } = fakeWatchFactory();
		const watcher = createWorkspaceFilesWatcher({
			onChange: (cwd) => changes.push(cwd),
			startWatch,
		});

		watcher.watch('/abs/workspace');
		for (let index = 0; index < 10; index += 1) {
			watches[0].changed(`src/file-${index}.ts`);
		}

		await sleep(AFTER_DEBOUNCE_MS);
		expect(changes).toEqual(['/abs/workspace']);
	});
});

const NEITHER: WorkspaceFilesChangeFlags = {
	membershipChanged: false,
	settingsChanged: false,
};

type FakeEvent = readonly [changed: string | null, kind?: WatchEventType];

/** Feeds one burst of events to a fresh watcher and returns what it delivered. */
async function flagsDeliveredFor(
	events: readonly FakeEvent[],
): Promise<WorkspaceFilesChangeFlags[]> {
	const delivered: WorkspaceFilesChangeFlags[] = [];
	const { startWatch, watches } = fakeWatchFactory();
	const watcher = createWorkspaceFilesWatcher({
		onChange: (_cwd, flags) => delivered.push(flags),
		startWatch,
	});

	watcher.watch('/abs/workspace');
	for (const [changed, kind] of events) {
		watches[0].changed(changed, kind);
	}

	await sleep(AFTER_DEBOUNCE_MS);
	return delivered;
}

describe('createWorkspaceFilesWatcher change flags', () => {
	test('a write to an existing file changes neither membership nor settings', async () => {
		expect(await flagsDeliveredFor([['src/app.ts']])).toEqual([NEITHER]);
	});

	test('a rename changes membership', async () => {
		expect(await flagsDeliveredFor([['src/new.ts', 'rename']])).toEqual([
			{ membershipChanged: true, settingsChanged: false },
		]);
	});

	test('an event that names no path may have changed anything', async () => {
		expect(await flagsDeliveredFor([[null]])).toEqual([
			{ membershipChanged: true, settingsChanged: true },
		]);
		expect(await flagsDeliveredFor([['']])).toEqual([
			{ membershipChanged: true, settingsChanged: true },
		]);
	});

	test('a .gitignore edit changes membership even as a plain write', async () => {
		expect(
			await flagsDeliveredFor([['.gitignore'], ['packages/web/.gitignore']]),
		).toEqual([{ membershipChanged: true, settingsChanged: false }]);
	});

	test('the committed settings file changes settings only', async () => {
		expect(
			await flagsDeliveredFor([[`${ENSEMBLR_DIRECTORY}/settings.toml`]]),
		).toEqual([{ membershipChanged: false, settingsChanged: true }]);
	});

	test('anything under the .ensemblr directory counts as a settings input', async () => {
		expect(
			await flagsDeliveredFor([
				[ENSEMBLR_DIRECTORY],
				[`${ENSEMBLR_DIRECTORY}\\architecture.json`],
			]),
		).toEqual([{ membershipChanged: false, settingsChanged: true }]);
	});

	test('the repository-root .worktreeinclude changes settings only', async () => {
		expect(await flagsDeliveredFor([[WORKTREE_INCLUDE_FILENAME]])).toEqual([
			{ membershipChanged: false, settingsChanged: true },
		]);
	});

	test('names that merely resemble a settings input change nothing', async () => {
		expect(
			await flagsDeliveredFor([
				[`${ENSEMBLR_DIRECTORY}-notes/todo.md`],
				[`docs/${WORKTREE_INCLUDE_FILENAME}`],
				['.gitignore-guide.md'],
			]),
		).toEqual([NEITHER]);
	});

	test('a burst accumulates every flag its events raised', async () => {
		expect(
			await flagsDeliveredFor([
				['src/a.ts'],
				['src/b.ts', 'rename'],
				[`${ENSEMBLR_DIRECTORY}/settings.toml`],
			]),
		).toEqual([{ membershipChanged: true, settingsChanged: true }]);
	});

	test('ignored churn adds no flags to the burst it lands in', async () => {
		expect(
			await flagsDeliveredFor([
				['src/a.ts'],
				['node_modules/react/index.js', 'rename'],
				['.git/HEAD', 'rename'],
			]),
		).toEqual([NEITHER]);
	});

	test('the burst after a delivered one starts with no flags raised', async () => {
		const delivered: WorkspaceFilesChangeFlags[] = [];
		const { startWatch, watches } = fakeWatchFactory();
		const watcher = createWorkspaceFilesWatcher({
			onChange: (_cwd, flags) => delivered.push(flags),
			startWatch,
		});

		watcher.watch('/abs/workspace');
		watches[0].changed('src/new.ts', 'rename');
		await sleep(AFTER_DEBOUNCE_MS);
		watches[0].changed('src/app.ts');
		await sleep(AFTER_DEBOUNCE_MS);

		expect(delivered).toEqual([
			{ membershipChanged: true, settingsChanged: false },
			NEITHER,
		]);
	});

	test('flags raised before a watch closed do not leak into the next watch', async () => {
		const delivered: WorkspaceFilesChangeFlags[] = [];
		const { startWatch, watches } = fakeWatchFactory();
		const watcher = createWorkspaceFilesWatcher({
			onChange: (_cwd, flags) => delivered.push(flags),
			startWatch,
		});

		watcher.watch('/abs/workspace');
		watches[0].changed('src/new.ts', 'rename');
		watcher.stopWatching('/abs/workspace');
		watcher.watch('/abs/workspace');
		watches[1].changed('src/app.ts');
		await sleep(AFTER_DEBOUNCE_MS);

		expect(delivered).toEqual([NEITHER]);
	});
});
