import { describe, expect, test } from 'bun:test';

import {
	createWorkspaceFilesWatcher,
	type StartWatch,
} from '../../src/main/workspace-files/watch-workspace-files';

// The watcher debounces at 250ms; wait past that before asserting.
const AFTER_DEBOUNCE_MS = 320;

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

interface FakeWatch {
	changed: (changed: string | null) => void;
	closed: boolean;
	directory: string;
	errored: () => void;
}

/** A {@link StartWatch} that records watches and lets tests fire/close them. */
function fakeWatchFactory(): { startWatch: StartWatch; watches: FakeWatch[] } {
	const watches: FakeWatch[] = [];
	const startWatch: StartWatch = (directory, onChange, onError) => {
		const record: FakeWatch = {
			changed: onChange,
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
