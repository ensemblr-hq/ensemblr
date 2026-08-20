// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '@/renderer/api/ensemblr-queries';
import { useReconcileWorkspaceState } from '@/renderer/hooks/workspace/use-reconcile-workspace-state';
import {
	lastRunScriptAtomFamily,
	retainLastRunScripts,
} from '@/renderer/state/preferences';
import {
	activeDockTabByWorkspaceAtom,
	activeReviewTabByWorkspaceAtom,
	changesSourceByWorkspaceAtom,
	continuedMergedPullRequestByWorkspaceAtom,
	dockVisitOrderByWorkspaceAtom,
} from '@/renderer/state/workspace/layout-atoms';
import {
	readLastUsedOpenTarget,
	writeLastUsedOpenTarget,
} from '@/renderer/state/workspace/open-target-history';
import {
	activeChatTabByWorkspaceAtom,
	sessionVisitOrderByWorkspaceAtom,
} from '@/renderer/state/workspace/selection-atoms';
import {
	pinnedWorkspaceIdsAtom,
	unreadWorkspaceIdsAtom,
	workspaceBoardOrderAtom,
	workspaceBoardStatusAtom,
} from '@/renderer/state/workspace/structure-atoms';
import { viewedChangesByWorkspaceAtom } from '@/renderer/state/workspace/viewed-changes';
import {
	forgetWorkspaceStateAtom,
	pruneWorkspaceStateAtom,
} from '@/renderer/state/workspace/workspace-state-eviction';

import { createTestQueryClient, installLocalStorage } from './support/dom';

const LIVE = 'workspace-live';
const GONE = 'workspace-gone';

/**
 * Seeds every store {@link WORKSPACE_KEYED_STORES} registers, plus the two
 * localStorage maps the reconciler collects alongside them, with an entry for
 * both workspaces. Keeping this exhaustive is what stops a store being dropped
 * from the registry unnoticed.
 */
function seedBothWorkspaces(store: ReturnType<typeof createStore>): void {
	store.set(activeChatTabByWorkspaceAtom, { [GONE]: 'tab-g', [LIVE]: 'tab-l' });
	store.set(sessionVisitOrderByWorkspaceAtom, {
		[GONE]: ['tab-g'],
		[LIVE]: ['tab-l'],
	});
	store.set(activeDockTabByWorkspaceAtom, { [GONE]: 'setup', [LIVE]: 'run' });
	store.set(activeReviewTabByWorkspaceAtom, {
		[GONE]: 'checks',
		[LIVE]: 'changes',
	});
	store.set(dockVisitOrderByWorkspaceAtom, {
		[GONE]: ['setup'],
		[LIVE]: ['run'],
	});
	store.set(changesSourceByWorkspaceAtom, {
		[GONE]: { kind: 'uncommitted' },
		[LIVE]: { kind: 'uncommitted' },
	});
	store.set(continuedMergedPullRequestByWorkspaceAtom, {
		[GONE]: 11,
		[LIVE]: 22,
	});
	store.set(viewedChangesByWorkspaceAtom, {
		[GONE]: { 'a.ts': 'rev-g' },
		[LIVE]: { 'b.ts': 'rev-l' },
	});
	store.set(workspaceBoardStatusAtom, {
		[GONE]: 'in-progress',
		[LIVE]: 'in-progress',
	});
	store.set(pinnedWorkspaceIdsAtom, [GONE, LIVE]);
	store.set(unreadWorkspaceIdsAtom, [GONE, LIVE]);
	store.set(workspaceBoardOrderAtom, [GONE, LIVE]);

	writeLastUsedOpenTarget(GONE, 'vscode');
	writeLastUsedOpenTarget(LIVE, 'vscode');
	store.set(lastRunScriptAtomFamily(GONE), 'dev');
	store.set(lastRunScriptAtomFamily(LIVE), 'dev');
}

/** Reads back only the workspace ids each seeded store still holds. */
function survivingWorkspaceIds(store: ReturnType<typeof createStore>) {
	return {
		activeChatTab: Object.keys(store.get(activeChatTabByWorkspaceAtom)),
		activeDockTab: Object.keys(store.get(activeDockTabByWorkspaceAtom)),
		activeReviewTab: Object.keys(store.get(activeReviewTabByWorkspaceAtom)),
		boardOrder: store.get(workspaceBoardOrderAtom),
		boardStatus: Object.keys(store.get(workspaceBoardStatusAtom)),
		changesSource: Object.keys(store.get(changesSourceByWorkspaceAtom)),
		continuedMergedPullRequest: Object.keys(
			store.get(continuedMergedPullRequestByWorkspaceAtom),
		),
		dockVisitOrder: Object.keys(store.get(dockVisitOrderByWorkspaceAtom)),
		pinned: store.get(pinnedWorkspaceIdsAtom),
		sessionVisitOrder: Object.keys(store.get(sessionVisitOrderByWorkspaceAtom)),
		unread: store.get(unreadWorkspaceIdsAtom),
		viewedChanges: Object.keys(store.get(viewedChangesByWorkspaceAtom)),
	};
}

/** The expected read-back once only {@link LIVE} survives. */
const ONLY_LIVE = {
	activeChatTab: [LIVE],
	activeDockTab: [LIVE],
	activeReviewTab: [LIVE],
	boardOrder: [LIVE],
	boardStatus: [LIVE],
	changesSource: [LIVE],
	continuedMergedPullRequest: [LIVE],
	dockVisitOrder: [LIVE],
	pinned: [LIVE],
	sessionVisitOrder: [LIVE],
	unread: [LIVE],
	viewedChanges: [LIVE],
};

/** Reads the raw stored run-script value for one workspace. */
function storedRunScript(workspaceId: string): string | null {
	return window.localStorage.getItem(
		`ensemblr_pref_last_run_script_${workspaceId}`,
	);
}

/** Stubs the History feed with one entry per given workspace id. */
function historyListing(workspaceIds: string[]) {
	return {
		entries: workspaceIds.map((id) => ({
			archivedAt: null,
			baseBranch: null,
			branchCleanup: false,
			branchName: null,
			createdAt: '2026-08-20T10:00:00.000Z',
			id,
			name: id,
			path: `/tmp/${id}`,
			repositoryId: 'repo',
			repositoryName: 'repo',
			slug: id,
			updatedAt: '2026-08-20T10:00:00.000Z',
		})),
	};
}

function renderReconcile(
	store: ReturnType<typeof createStore>,
	client: ReturnType<typeof createTestQueryClient>,
) {
	return renderHook(() => useReconcileWorkspaceState(), {
		wrapper: ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>
				<Provider store={store}>{children}</Provider>
			</QueryClientProvider>
		),
	});
}

describe('workspace state eviction', () => {
	let store: ReturnType<typeof createStore>;
	let client: ReturnType<typeof createTestQueryClient>;

	beforeEach(() => {
		installLocalStorage();
		vi.clearAllMocks();
		store = createStore();
		client = createTestQueryClient();
		seedBothWorkspaces(store);
	});

	test('forgetting one workspace clears it from every workspace-keyed store', () => {
		store.set(forgetWorkspaceStateAtom, GONE);

		expect(survivingWorkspaceIds(store)).toEqual(ONLY_LIVE);
	});

	test('pruning keeps only the workspaces that still exist', () => {
		store.set(pruneWorkspaceStateAtom, new Set([LIVE]));

		expect(survivingWorkspaceIds(store)).toEqual(ONLY_LIVE);
	});

	test('pruning leaves a store untouched when every entry survives', () => {
		const before = store.get(activeChatTabByWorkspaceAtom);

		store.set(pruneWorkspaceStateAtom, new Set([GONE, LIVE]));

		expect(store.get(activeChatTabByWorkspaceAtom)).toBe(before);
	});

	// "Nothing loaded yet" and "everything was deleted" are indistinguishable
	// here, so the atom refuses rather than wiping the install's preferences.
	test('pruning against an empty set is refused', () => {
		store.set(pruneWorkspaceStateAtom, new Set<string>());

		expect(Object.keys(store.get(activeChatTabByWorkspaceAtom)).sort()).toEqual(
			[GONE, LIVE],
		);
	});

	test('the reconciler drops workspaces the History feed no longer lists', async () => {
		client.setQueryData(
			ensemblrQueryKeys.workspaceHistory(),
			historyListing([LIVE]),
		);

		renderReconcile(store, client);

		await waitFor(() =>
			expect(survivingWorkspaceIds(store)).toEqual(ONLY_LIVE),
		);
		expect(readLastUsedOpenTarget(GONE)).toBeNull();
		expect(readLastUsedOpenTarget(LIVE)).toBe('vscode');
		expect(storedRunScript(GONE)).toBeNull();
		expect(storedRunScript(LIVE)).toBe(JSON.stringify('dev'));
	});

	// Archiving is reversible, and the History feed carries archived workspaces
	// precisely so an unarchive gets its board column and tabs back.
	test('the reconciler keeps an archived workspace that is still on record', async () => {
		client.setQueryData(ensemblrQueryKeys.workspaceHistory(), {
			entries: [
				...historyListing([LIVE]).entries,
				{
					...historyListing([GONE]).entries[0],
					archivedAt: '2026-08-19T10:00:00.000Z',
				},
			],
		});

		renderReconcile(store, client);

		await waitFor(() =>
			expect(
				Object.keys(store.get(activeChatTabByWorkspaceAtom)).sort(),
			).toEqual([GONE, LIVE]),
		);
		expect(store.get(pinnedWorkspaceIdsAtom)).toEqual([GONE, LIVE]);
	});

	test('the reconciler treats an empty feed as not-loaded-yet', async () => {
		client.setQueryData(ensemblrQueryKeys.workspaceHistory(), {
			entries: [],
		});

		renderReconcile(store, client);

		await waitFor(() =>
			expect(
				Object.keys(store.get(activeChatTabByWorkspaceAtom)).sort(),
			).toEqual([GONE, LIVE]),
		);
	});
});

describe('last-run-script eviction', () => {
	let store: ReturnType<typeof createStore>;

	beforeEach(() => {
		installLocalStorage();
		store = createStore();
		store.set(lastRunScriptAtomFamily(GONE), 'dev');
		store.set(lastRunScriptAtomFamily(LIVE), 'build');
	});

	test('retaining sweeps the keys of workspaces that no longer exist', () => {
		retainLastRunScripts(new Set([LIVE]));

		expect(storedRunScript(GONE)).toBeNull();
		expect(storedRunScript(LIVE)).toBe(JSON.stringify('build'));
	});

	// Same "nothing loaded yet" ambiguity the prune atom refuses on.
	test('retaining against an empty set is refused', () => {
		retainLastRunScripts(new Set<string>());

		expect(storedRunScript(GONE)).toBe(JSON.stringify('dev'));
		expect(storedRunScript(LIVE)).toBe(JSON.stringify('build'));
	});
});
