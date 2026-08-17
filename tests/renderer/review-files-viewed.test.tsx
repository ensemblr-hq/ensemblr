// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test } from 'vitest';

import { TooltipProvider } from '../../src/renderer/components/ui/tooltip';
import { ReviewFileList } from '../../src/renderer/components/workbench-shell/review-files/review-file-list';
import {
	findReviewFileRevision,
	reviewFileRevision,
	sortReviewFilesByViewed,
} from '../../src/renderer/lib/workbench/review-files';
import {
	forgetWorkspaceViewedChangesAtom,
	MAX_VIEWED_MARKS_PER_WORKSPACE,
	useViewedChanges,
	viewedChangesByWorkspaceAtom,
} from '../../src/renderer/state/workspace';
import type { ReviewFileSummary } from '../../src/renderer/types/workbench';
import { installLocalStorage } from './support/dom';

// Marks persist to localStorage, so each test needs its own storage or the
// previous test's marks arrive with the atom when it mounts.
beforeEach(installLocalStorage);

const FIRST: ReviewFileSummary = {
	additions: 10,
	contentId: null,
	deletions: 3,
	id: 'a',
	path: 'src/first.ts',
	status: 'modified',
};

const SECOND: ReviewFileSummary = {
	additions: 5,
	contentId: null,
	deletions: 1,
	id: 'b',
	path: 'src/second.ts',
	status: 'modified',
};

/** Renders the hook against a store the test can keep writing to. */
function renderViewedChanges(workspaceId = 'w1') {
	const store = createStore();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
	return {
		...renderHook(() => useViewedChanges(workspaceId), { wrapper }),
		store,
	};
}

/** Renders the flat Changes list against a store, returning the row paths in order. */
function renderList(store: ReturnType<typeof createStore>) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { container } = render(
		<Provider store={store}>
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
					<ReviewFileList
						files={[FIRST, SECOND]}
						onDiscardFile={() => {}}
						viewMode='list'
						workspaceCwd='/tmp/ws'
						workspaceId='w1'
					/>
				</TooltipProvider>
			</QueryClientProvider>
		</Provider>,
	);
	const rows = [...container.querySelectorAll('[data-row-path]')];
	return {
		container,
		rowFor: (path: string) =>
			rows.find((row) => row.getAttribute('data-row-path') === path) as Element,
		paths: rows.map((row) => row.getAttribute('data-row-path')),
	};
}

describe('viewed marks expire when the file changes again', () => {
	test('a mark reads back only at the revision it was set at', () => {
		const { result } = renderViewedChanges();
		const revision = reviewFileRevision(FIRST);

		act(() => result.current.setViewed(FIRST.path, revision, true));

		expect(result.current.isViewed(FIRST.path, revision)).toBe(true);
		expect(
			result.current.isViewed(
				FIRST.path,
				reviewFileRevision({ ...FIRST, additions: FIRST.additions + 1 }),
			),
		).toBe(false);
	});

	test('unmarking clears the file without disturbing the others', () => {
		const { result } = renderViewedChanges();
		const first = reviewFileRevision(FIRST);
		const second = reviewFileRevision(SECOND);

		act(() => result.current.setViewed(FIRST.path, first, true));
		act(() => result.current.setViewed(SECOND.path, second, true));
		act(() => result.current.setViewed(FIRST.path, first, false));

		expect(result.current.isViewed(FIRST.path, first)).toBe(false);
		expect(result.current.isViewed(SECOND.path, second)).toBe(true);
	});

	test('marks belong to one workspace', () => {
		const store = createStore();
		const wrapper = ({ children }: { children: ReactNode }) => (
			<Provider store={store}>{children}</Provider>
		);
		const mine = renderHook(() => useViewedChanges('w1'), { wrapper });
		const other = renderHook(() => useViewedChanges('w2'), { wrapper });
		const revision = reviewFileRevision(FIRST);

		act(() => mine.result.current.setViewed(FIRST.path, revision, true));

		expect(mine.result.current.isViewed(FIRST.path, revision)).toBe(true);
		expect(other.result.current.isViewed(FIRST.path, revision)).toBe(false);
	});

	test('a revision is looked up from git status rows, or null when absent', () => {
		const files = [
			{
				additions: 10,
				deletions: 3,
				path: 'src/first.ts',
				status: 'modified' as const,
			},
		];

		expect(findReviewFileRevision(files, 'src/first.ts')).toBe(
			reviewFileRevision(FIRST),
		);
		expect(findReviewFileRevision(files, 'src/absent.ts')).toBeNull();
	});
});

describe('viewed rows sink to the end of the flat list', () => {
	test('the sort keeps the incoming order inside each group', () => {
		const sorted = sortReviewFilesByViewed(
			[FIRST, SECOND],
			(file) => file.path === FIRST.path,
		);

		expect(sorted.map((file) => file.path)).toEqual([SECOND.path, FIRST.path]);
	});

	test('marking the first file moves and dims its row', () => {
		const { result, store } = renderViewedChanges();
		expect(renderList(store).paths).toEqual([FIRST.path, SECOND.path]);

		act(() =>
			result.current.setViewed(FIRST.path, reviewFileRevision(FIRST), true),
		);
		const marked = renderList(store);

		expect(marked.paths).toEqual([SECOND.path, FIRST.path]);
		expect(marked.rowFor(FIRST.path).className).toContain('opacity-50');
		expect(marked.rowFor(SECOND.path).className).not.toContain('opacity-50');
		expect(
			marked.rowFor(FIRST.path).querySelector('[aria-label="Viewed"]'),
		).not.toBeNull();
	});

	test('a file the agent touched again climbs back out of the viewed group', () => {
		const { result, store } = renderViewedChanges();

		act(() =>
			result.current.setViewed(
				FIRST.path,
				reviewFileRevision({ ...FIRST, additions: 1 }),
				true,
			),
		);
		const listed = renderList(store);

		expect(listed.paths).toEqual([FIRST.path, SECOND.path]);
		expect(listed.rowFor(FIRST.path).className).not.toContain('opacity-50');
	});
});

describe('a revision tracks content, not just the shape of the change', () => {
	test('an edit that leaves the line counts alone still expires the mark', () => {
		const stamped = { ...FIRST, contentId: '120:1000' };
		const rewritten = { ...stamped, contentId: '120:2000' };
		const { result } = renderViewedChanges();

		act(() =>
			result.current.setViewed(stamped.path, reviewFileRevision(stamped), true),
		);

		expect(reviewFileRevision(rewritten)).not.toBe(reviewFileRevision(stamped));
		expect(
			result.current.isViewed(rewritten.path, reviewFileRevision(rewritten)),
		).toBe(false);
	});

	test('a binary file, whose counts are always zero, expires on any write', () => {
		const binary: ReviewFileSummary = {
			additions: 0,
			contentId: '4:1000',
			deletions: 0,
			id: 'logo',
			path: 'assets/logo.png',
			status: 'modified',
		};

		expect(reviewFileRevision({ ...binary, contentId: '4:2000' })).not.toBe(
			reviewFileRevision(binary),
		);
	});

	test('a scope with no stamp falls back to status and counts', () => {
		const files = [
			{
				additions: 10,
				deletions: 3,
				path: 'src/first.ts',
				status: 'modified' as const,
			},
		];

		expect(findReviewFileRevision(files, 'src/first.ts')).toBe(
			reviewFileRevision(FIRST),
		);
	});

	test('a stamp on the wire reaches the revision', () => {
		const files = [
			{
				additions: 10,
				contentId: '120:1000',
				deletions: 3,
				path: 'src/first.ts',
				status: 'modified' as const,
			},
		];

		expect(findReviewFileRevision(files, 'src/first.ts')).toBe(
			reviewFileRevision({ ...FIRST, contentId: '120:1000' }),
		);
	});
});

describe('marks outlive the change set they were made against', () => {
	test('a write under one diff scope keeps marks made under another', () => {
		const { result, store } = renderViewedChanges();

		// Signed off while the Changes source was the working tree.
		act(() =>
			result.current.setViewed(FIRST.path, reviewFileRevision(FIRST), true),
		);
		act(() =>
			result.current.setViewed(SECOND.path, reviewFileRevision(SECOND), true),
		);

		// A commit source holds neither of those paths. Signing off one of its
		// files must not read as "the working tree's files were never reviewed".
		act(() =>
			result.current.setViewed('docs/only-in-commit.md', 'commit-rev', true),
		);

		expect(store.get(viewedChangesByWorkspaceAtom).w1).toEqual({
			'docs/only-in-commit.md': 'commit-rev',
			[FIRST.path]: reviewFileRevision(FIRST),
			[SECOND.path]: reviewFileRevision(SECOND),
		});
	});

	test('unmarking drops that path alone', () => {
		const { result, store } = renderViewedChanges();

		act(() =>
			result.current.setViewed(FIRST.path, reviewFileRevision(FIRST), true),
		);
		act(() =>
			result.current.setViewed(SECOND.path, reviewFileRevision(SECOND), true),
		);
		act(() =>
			result.current.setViewed(FIRST.path, reviewFileRevision(FIRST), false),
		);

		expect(store.get(viewedChangesByWorkspaceAtom).w1).toEqual({
			[SECOND.path]: reviewFileRevision(SECOND),
		});
	});

	test('a workspace holds a bounded number of marks, oldest dropped first', () => {
		const { result, store } = renderViewedChanges();
		const overflow = MAX_VIEWED_MARKS_PER_WORKSPACE + 2;

		act(() => {
			for (let index = 0; index < overflow; index += 1) {
				result.current.setViewed(`src/file-${index}.ts`, 'rev', true);
			}
		});

		const marks = store.get(viewedChangesByWorkspaceAtom).w1;
		expect(Object.keys(marks)).toHaveLength(MAX_VIEWED_MARKS_PER_WORKSPACE);
		expect(marks['src/file-0.ts']).toBeUndefined();
		expect(marks['src/file-1.ts']).toBeUndefined();
		expect(marks[`src/file-${overflow - 1}.ts`]).toBe('rev');
	});

	test('removing a workspace drops its marks and leaves the others', () => {
		const store = createStore();
		const wrapper = ({ children }: { children: ReactNode }) => (
			<Provider store={store}>{children}</Provider>
		);
		const mine = renderHook(() => useViewedChanges('w1'), { wrapper });
		const other = renderHook(() => useViewedChanges('w2'), { wrapper });
		const revision = reviewFileRevision(FIRST);
		act(() => mine.result.current.setViewed(FIRST.path, revision, true));
		act(() => other.result.current.setViewed(FIRST.path, revision, true));

		act(() => store.set(forgetWorkspaceViewedChangesAtom, 'w1'));

		expect(store.get(viewedChangesByWorkspaceAtom)).toEqual({
			w2: { [FIRST.path]: revision },
		});
	});
});
