// @vitest-environment happy-dom

/**
 * The Changes list mounted a full row (menus, tooltips, subscriptions) for every
 * changed file, so a large change set made each git-status refresh re-render
 * hundreds of rows. It now windows its rows through a virtualizer and memoizes
 * them on the file's contents, so only the on-screen rows exist and a refresh
 * that changed nothing renders none of them.
 */

import { act, fireEvent } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
	ReviewFilePreviewOpenerProvider,
	WorkspaceFileDiffOpenerProvider,
} from '../../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { ReviewFileList } from '../../../src/renderer/components/workbench-shell/review-files/review-file-list';
import { reviewFileRevision } from '../../../src/renderer/lib/workbench/review-files';
import { viewedChangesByWorkspaceAtom } from '../../../src/renderer/state/workspace';
import type { ReviewFileSummary } from '../../../src/renderer/types/workbench';
import type { ChangesViewMode } from '../../../src/renderer/types/workbench-shell';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	installLocalStorage,
	installScrollViewport,
	renderWithProviders,
} from '../support/dom';

const renders = vi.hoisted(() => ({
	files: new Map<string, number>(),
	folders: new Map<string, number>(),
	rowModelCalls: 0,
}));

vi.mock(
	'@/renderer/hooks/workbench-shell/review-files/use-review-file-rows',
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import('@/renderer/hooks/workbench-shell/review-files/use-review-file-rows')
			>();
		return {
			...actual,
			useReviewFileRows: (
				...args: Parameters<typeof actual.useReviewFileRows>
			) => {
				renders.rowModelCalls += 1;
				return actual.useReviewFileRows(...args);
			},
		};
	},
);

vi.mock('@/renderer/components/file-path-label', () => ({
	FilePathLabel: ({ path }: { path: string }) => {
		renders.files.set(path, (renders.files.get(path) ?? 0) + 1);
		return <span>{path}</span>;
	},
}));

vi.mock(
	'@/renderer/components/workbench-shell/review-files/file-tree-label',
	() => ({
		FileTreeLabel: ({ parts }: { parts: readonly string[] }) => {
			const key = parts.join('/');
			renders.folders.set(key, (renders.folders.get(key) ?? 0) + 1);
			return <span>{key}</span>;
		},
	}),
);

const VIEWPORT_HEIGHT = 600;
const MOUNTED_ROW_BUDGET = 80;

/** A modified file row shaped like the git-status mapper's output. */
function changedFile(path: string, additions = 1): ReviewFileSummary {
	return {
		additions,
		contentId: null,
		deletions: 0,
		id: `git:${path}`,
		path,
		status: 'modified',
	};
}

/** 600 files spread over 30 packages of 20 files each. */
function largeChangeSet(): ReviewFileSummary[] {
	return Array.from({ length: 600 }, (_unused, index) =>
		changedFile(
			`pkg-${String(Math.floor(index / 20)).padStart(2, '0')}/file-${String(index % 20).padStart(2, '0')}.ts`,
		),
	);
}

/** Props of the list a test varies between renders. */
interface ListInput {
	discardablePaths?: ReadonlySet<string>;
	files: ReviewFileSummary[];
	pendingDiscardPaths?: ReadonlySet<string>;
}

/** Lists `files` at `viewMode`, through a jotai store the test can write marks to. */
function renderList(
	files: ReviewFileSummary[],
	{
		conflictPaths,
		store = createStore(),
		viewMode = 'list',
	}: {
		conflictPaths?: ReadonlySet<string>;
		store?: ReturnType<typeof createStore>;
		viewMode?: ChangesViewMode;
	} = {},
	initial: Omit<ListInput, 'files'> = {},
) {
	const list = (next: ListInput) => (
		<Provider store={store}>
			<WorkspaceFileDiffOpenerProvider value={openDiff}>
				<ReviewFilePreviewOpenerProvider value={openPreview}>
					<ReviewFileList
						conflictPaths={conflictPaths}
						discardablePaths={next.discardablePaths}
						files={next.files}
						onDiscardFile={onDiscardFile}
						pendingDiscardPaths={next.pendingDiscardPaths}
						viewMode={viewMode}
						workspaceCwd='/tmp/ws'
						workspaceId='w1'
					/>
				</ReviewFilePreviewOpenerProvider>
			</WorkspaceFileDiffOpenerProvider>
		</Provider>
	);
	const view = renderWithProviders(list({ ...initial, files }));
	return {
		...view,
		rerenderFiles: (
			next: ReviewFileSummary[],
			rest: Omit<ListInput, 'files'> = initial,
		) => view.rerender(list({ ...rest, files: next })),
		store,
	};
}

const onDiscardFile = vi.fn();
const openDiff = vi.fn();
const openPreview = vi.fn();

/** Lets query-cache notifications and the virtualizer's re-measure land. */
async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
}

/** Paths of the mounted file rows, in DOM order. */
function mountedPaths(): string[] {
	return [...document.querySelectorAll<HTMLElement>('[data-row-path]')].map(
		(row) => row.dataset.rowPath ?? '',
	);
}

/** The virtualized track's height, which is what the scrollbar reflects. */
function trackHeight(): number {
	const track = document.querySelector<HTMLElement>(
		'.sleek-scrollbar > div',
	) as HTMLElement;
	return Number.parseInt(track.style.height, 10);
}

/** Forgets every render counted so far, so a test measures only what follows. */
function resetRenderCounts() {
	renders.files.clear();
	renders.folders.clear();
	renders.rowModelCalls = 0;
}

/** Total row renders counted since the last reset. */
function totalRowRenders(): number {
	return [...renders.files.values(), ...renders.folders.values()].reduce(
		(sum, count) => sum + count,
		0,
	);
}

beforeEach(() => {
	resetRenderCounts();
	installLocalStorage();
	installEnsemblrApi({
		listWorkspaceOpenTargets: async () => ({ targets: [] }),
	});
	const restoreViewport = installScrollViewport(VIEWPORT_HEIGHT);
	return () => {
		restoreViewport();
		clearEnsemblrApi();
	};
});

afterEach(() => {
	onDiscardFile.mockReset();
});

describe('windowing', () => {
	test('a 600-file list mounts a window of rows, not all of them', async () => {
		renderList(largeChangeSet());
		await settle();

		expect(mountedPaths().length).toBeGreaterThan(0);
		expect(mountedPaths().length).toBeLessThanOrEqual(MOUNTED_ROW_BUDGET);
	});

	test('a 600-file folder tree mounts a window of rows, not all of them', async () => {
		renderList(largeChangeSet(), { viewMode: 'folders' });
		await settle();

		const treeitems = document.querySelectorAll('[role="treeitem"]');
		expect(treeitems.length).toBeGreaterThan(0);
		expect(treeitems.length).toBeLessThanOrEqual(MOUNTED_ROW_BUDGET);
	});

	test('the scroll track is as tall as every row put together', async () => {
		renderList(largeChangeSet());
		await settle();
		expect(trackHeight()).toBe(600 * 36);
	});

	test('a folder tree track adds a folder row per package', async () => {
		renderList(largeChangeSet(), { viewMode: 'folders' });
		await settle();
		expect(trackHeight()).toBe(30 * 32 + 600 * 36);
	});

	test('the list is not an ARIA tree, the folder view is', async () => {
		const list = renderList(largeChangeSet());
		await settle();
		expect(document.querySelector('[role="tree"]')).toBeNull();
		list.unmount();

		renderList(largeChangeSet(), { viewMode: 'folders' });
		await settle();
		expect(document.querySelectorAll('[role="tree"]')).toHaveLength(1);
	});
});

describe('folder tree', () => {
	const files = [
		changedFile('README.md'),
		changedFile('src/a.ts'),
		changedFile('src/nested/b.ts'),
	];

	test('lists directories before files with their tree levels', async () => {
		renderList(files, { viewMode: 'folders' });
		await settle();

		const items = [...document.querySelectorAll('[role="treeitem"]')].map(
			(item) => [
				item.getAttribute('data-row-path') ?? 'folder',
				item.getAttribute('aria-level'),
				item.getAttribute('aria-expanded'),
			],
		);
		expect(items).toEqual([
			['folder', '1', 'true'],
			['folder', '2', 'true'],
			['src/nested/b.ts', '3', null],
			['src/a.ts', '2', null],
			['README.md', '1', null],
		]);
	});

	test('clicking a folder collapses it and unmounts what it held', async () => {
		renderList(files, { viewMode: 'folders' });
		await settle();
		const nested = document.querySelectorAll<HTMLElement>(
			'[role="treeitem"][aria-expanded]',
		)[1];

		fireEvent.click(nested);
		await settle();

		expect(mountedPaths()).toEqual(['src/a.ts', 'README.md']);
		expect(document.querySelectorAll('[aria-expanded="false"]')).toHaveLength(
			1,
		);
	});
});

describe('conflicts and viewed marks', () => {
	const files = [changedFile('a.ts'), changedFile('b.ts'), changedFile('c.ts')];

	test('conflicted files lead under their own header, viewed clean files sink', async () => {
		const store = createStore();
		renderList(files, { conflictPaths: new Set(['b.ts']), store });
		await settle();
		expect(
			[...document.querySelectorAll('h3')].map(
				(heading) => heading.textContent,
			),
		).toEqual(['Conflicts', 'Clean']);
		expect(mountedPaths()).toEqual(['b.ts', 'a.ts', 'c.ts']);
		const cRow = document.querySelector('[data-row-path="c.ts"]');

		act(() =>
			store.set(viewedChangesByWorkspaceAtom, {
				w1: { 'a.ts': reviewFileRevision(files[0]) },
			}),
		);
		await settle();

		expect(mountedPaths()).toEqual(['b.ts', 'c.ts', 'a.ts']);
		expect(document.querySelector('[data-row-path="c.ts"]')).toBe(cRow);
	});
});

describe('render budget', () => {
	test('a status refresh that changed nothing renders no row', async () => {
		const view = renderList(largeChangeSet());
		await settle();
		resetRenderCounts();

		view.rerenderFiles(largeChangeSet());
		await settle();

		expect(totalRowRenders()).toBe(0);
	});

	test('a folder tree refresh that changed nothing renders no row', async () => {
		const tree = () => [
			changedFile('a.ts'),
			changedFile('b.ts'),
			changedFile('src/nested/c.ts'),
			changedFile('src/d.ts'),
		];
		const view = renderList(tree(), { viewMode: 'folders' });
		await settle();
		expect([...renders.files.keys()]).toEqual(['a.ts', 'b.ts']);
		expect([...renders.folders.keys()]).toEqual(['src', 'nested']);
		resetRenderCounts();

		view.rerenderFiles(tree());
		await settle();

		expect(totalRowRenders()).toBe(0);
	});

	test('fresh but equal discardable and pending sets render no row', async () => {
		const sets = () => ({
			discardablePaths: new Set(['pkg-00/file-00.ts']),
			pendingDiscardPaths: new Set<string>(),
		});
		const view = renderList(largeChangeSet(), {}, sets());
		await settle();
		resetRenderCounts();

		view.rerenderFiles(largeChangeSet(), sets());
		await settle();

		expect(totalRowRenders()).toBe(0);
	});

	test('re-rendering the list with the same props skips its row model', async () => {
		const files = largeChangeSet();
		const view = renderList(files);
		await settle();
		resetRenderCounts();

		view.rerenderFiles(files);
		view.rerenderFiles(files);
		await settle();

		expect(renders.rowModelCalls).toBe(0);
	});

	test('changing one file renders that row and no other', async () => {
		const original = largeChangeSet();
		const view = renderList(original);
		await settle();
		resetRenderCounts();

		view.rerenderFiles(
			original.map((file, index) =>
				index === 3 ? changedFile(file.path, file.additions + 1) : { ...file },
			),
		);
		await settle();

		expect([...renders.files.entries()]).toEqual([[original[3].path, 1]]);
	});
});
