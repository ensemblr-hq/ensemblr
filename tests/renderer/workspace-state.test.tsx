import { afterEach, expect, test } from 'bun:test';
import { createStore } from 'jotai';
import { getDefaultWorkspace } from '../../src/renderer/mocks/workbench';
import {
	activeDockTabByWorkspaceAtom,
	activeReviewTabByWorkspaceAtom,
	changesViewModeAtom,
	closedSessionIdsByWorkspaceAtom,
	collapsedProjectIdsAtom,
	getPreferredDockTab,
	getPreferredReviewTab,
	orderedProjectIdsAtom,
	pinnedWorkspaceIdsAtom,
	rightSidebarCollapsedAtom,
	rightSidebarSizePercentAtom,
} from '../../src/renderer/state/workspace';

const STORAGE_KEYS = {
	activeDockTabByWorkspace: 'ensemble_workspace_active_dock_tab_by_workspace',
	activeReviewTabByWorkspace:
		'ensemble_workspace_active_review_tab_by_workspace',
	changesViewMode: 'ensemble_workspace_changes_view_mode',
	closedSessionIdsByWorkspace:
		'ensemble_workspace_closed_session_ids_by_workspace',
	collapsedProjectIds: 'ensemble_workspace_collapsed_project_ids',
	orderedProjectIds: 'ensemble_workspace_ordered_project_ids',
	pinnedWorkspaceIds: 'ensemble_workspace_pinned_workspace_ids',
	rightSidebarCollapsed: 'ensemble_workspace_right_sidebar_collapsed',
	rightSidebarSizePercent: 'ensemble_workspace_right_sidebar_size_percent',
};

class MemoryStorage implements Storage {
	readonly #items = new Map<string, string>();

	constructor(initialItems: Record<string, string> = {}) {
		for (const [key, value] of Object.entries(initialItems)) {
			this.#items.set(key, value);
		}
	}

	get length() {
		return this.#items.size;
	}

	clear() {
		this.#items.clear();
	}

	getItem(key: string) {
		return this.#items.get(key) ?? null;
	}

	key(index: number) {
		return Array.from(this.#items.keys())[index] ?? null;
	}

	removeItem(key: string) {
		this.#items.delete(key);
	}

	setItem(key: string, value: string) {
		this.#items.set(key, value);
	}
}

function installLocalStorage(initialItems?: Record<string, string>) {
	const storage = new MemoryStorage(initialItems);

	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: storage,
	});
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { localStorage: storage },
	});

	return storage;
}

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'localStorage');
	Reflect.deleteProperty(globalThis, 'window');
});

test('hydrates workspace navigation atoms from localStorage when mounted', () => {
	installLocalStorage({
		[STORAGE_KEYS.activeDockTabByWorkspace]: JSON.stringify({
			'workspace-a': 'run',
		}),
		[STORAGE_KEYS.activeReviewTabByWorkspace]: JSON.stringify({
			'workspace-a': 'checks',
		}),
		[STORAGE_KEYS.closedSessionIdsByWorkspace]: JSON.stringify({
			'workspace-a': ['session-a'],
		}),
		[STORAGE_KEYS.changesViewMode]: JSON.stringify('folders'),
		[STORAGE_KEYS.collapsedProjectIds]: JSON.stringify(['project-a']),
		[STORAGE_KEYS.orderedProjectIds]: JSON.stringify([
			'project-b',
			'project-a',
		]),
		[STORAGE_KEYS.pinnedWorkspaceIds]: JSON.stringify(['workspace-a']),
		[STORAGE_KEYS.rightSidebarCollapsed]: JSON.stringify(true),
		[STORAGE_KEYS.rightSidebarSizePercent]: JSON.stringify(48),
	});

	const store = createStore();
	const unsubscribes = [
		store.sub(activeDockTabByWorkspaceAtom, () => undefined),
		store.sub(activeReviewTabByWorkspaceAtom, () => undefined),
		store.sub(changesViewModeAtom, () => undefined),
		store.sub(orderedProjectIdsAtom, () => undefined),
		store.sub(collapsedProjectIdsAtom, () => undefined),
		store.sub(pinnedWorkspaceIdsAtom, () => undefined),
		store.sub(rightSidebarCollapsedAtom, () => undefined),
		store.sub(rightSidebarSizePercentAtom, () => undefined),
		store.sub(closedSessionIdsByWorkspaceAtom, () => undefined),
	];

	try {
		expect(store.get(activeDockTabByWorkspaceAtom)).toEqual({
			'workspace-a': 'run',
		});
		expect(store.get(activeReviewTabByWorkspaceAtom)).toEqual({
			'workspace-a': 'checks',
		});
		expect(store.get(changesViewModeAtom)).toBe('folders');
		expect(store.get(orderedProjectIdsAtom)).toEqual([
			'project-b',
			'project-a',
		]);
		expect(store.get(collapsedProjectIdsAtom)).toEqual(['project-a']);
		expect(store.get(pinnedWorkspaceIdsAtom)).toEqual(['workspace-a']);
		expect(store.get(rightSidebarCollapsedAtom)).toBe(true);
		expect(store.get(rightSidebarSizePercentAtom)).toBe(48);
		expect(store.get(closedSessionIdsByWorkspaceAtom)).toEqual({
			'workspace-a': ['session-a'],
		});
	} finally {
		for (const unsubscribe of unsubscribes) {
			unsubscribe();
		}
	}
});

test('writes workspace navigation atom changes to localStorage', () => {
	const storage = installLocalStorage();
	const store = createStore();

	store.set(activeDockTabByWorkspaceAtom, { 'workspace-b': 'terminal:logs' });
	store.set(activeReviewTabByWorkspaceAtom, { 'workspace-b': 'files' });
	store.set(changesViewModeAtom, 'folders');
	store.set(orderedProjectIdsAtom, ['project-a', 'project-b']);
	store.set(collapsedProjectIdsAtom, ['project-b']);
	store.set(pinnedWorkspaceIdsAtom, ['workspace-b']);
	store.set(rightSidebarCollapsedAtom, true);
	store.set(rightSidebarSizePercentAtom, 52);
	store.set(closedSessionIdsByWorkspaceAtom, {
		'workspace-b': ['session-b'],
	});

	expect(storage.getItem(STORAGE_KEYS.activeDockTabByWorkspace)).toBe(
		JSON.stringify({ 'workspace-b': 'terminal:logs' }),
	);
	expect(storage.getItem(STORAGE_KEYS.activeReviewTabByWorkspace)).toBe(
		JSON.stringify({ 'workspace-b': 'files' }),
	);
	expect(storage.getItem(STORAGE_KEYS.changesViewMode)).toBe(
		JSON.stringify('folders'),
	);
	expect(storage.getItem(STORAGE_KEYS.orderedProjectIds)).toBe(
		JSON.stringify(['project-a', 'project-b']),
	);
	expect(storage.getItem(STORAGE_KEYS.collapsedProjectIds)).toBe(
		JSON.stringify(['project-b']),
	);
	expect(storage.getItem(STORAGE_KEYS.pinnedWorkspaceIds)).toBe(
		JSON.stringify(['workspace-b']),
	);
	expect(storage.getItem(STORAGE_KEYS.rightSidebarCollapsed)).toBe(
		JSON.stringify(true),
	);
	expect(storage.getItem(STORAGE_KEYS.rightSidebarSizePercent)).toBe(
		JSON.stringify(52),
	);
	expect(storage.getItem(STORAGE_KEYS.closedSessionIdsByWorkspace)).toBe(
		JSON.stringify({ 'workspace-b': ['session-b'] }),
	);
});

test('resolves per-workspace review and dock tab preferences', () => {
	const workspace = getDefaultWorkspace();

	expect(
		getPreferredReviewTab({
			reviewTabsByWorkspace: { [workspace.id]: 'files' },
			workspaceId: workspace.id,
		}),
	).toBe('files');
	expect(
		getPreferredReviewTab({
			reviewTabsByWorkspace: { [workspace.id]: 'invalid' },
			workspaceId: workspace.id,
		}),
	).toBe('changes');
	expect(
		getPreferredReviewTab({
			reviewTabsByWorkspace: { [workspace.id]: 'files' },
			routeReviewTab: 'checks',
			workspaceId: workspace.id,
		}),
	).toBe('checks');
	expect(
		getPreferredDockTab({
			dockTabsByWorkspace: { [workspace.id]: 'run' },
			workspace,
		}),
	).toBe('run');
	expect(
		getPreferredDockTab({
			dockTabsByWorkspace: { [workspace.id]: 'terminal:missing' },
			workspace,
		}),
	).toBe('setup');
	expect(
		getPreferredDockTab({
			dockTabsByWorkspace: { [workspace.id]: 'run' },
			routeDockTab: 'terminal:default',
			workspace,
		}),
	).toBe('terminal:default');
});
