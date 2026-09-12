import { createStore } from 'jotai';
import { afterEach, expect, test } from 'vitest';
import { getDefaultWorkspace } from '../../src/renderer/fixtures/workbench';
import {
	activeChatTabByWorkspaceAtom,
	activeDockTabByWorkspaceAtom,
	activeReviewTabByWorkspaceAtom,
	changesViewModeAtom,
	collapsedProjectIdsAtom,
	getPreferredChatId,
	getPreferredDockTab,
	getPreferredReviewTab,
	lastWorkspaceSelectionAtom,
	orderedProjectIdsAtom,
	pinnedWorkspaceIdsAtom,
	rightSidebarCollapsedAtom,
	rightSidebarSizePercentAtom,
	sessionVisitOrderByWorkspaceAtom,
} from '../../src/renderer/state/workspace';
import type {
	TerminalDockTabId,
	WorkspaceShellModel,
} from '../../src/renderer/types/workbench';

const STORAGE_KEYS = {
	activeChatTabByWorkspace: 'ensemblr_workspace_active_chat_tab_by_workspace',
	activeDockTabByWorkspace: 'ensemblr_workspace_active_dock_tab_by_workspace',
	activeReviewTabByWorkspace:
		'ensemblr_workspace_active_review_tab_by_workspace',
	changesViewMode: 'ensemblr_workspace_changes_view_mode',
	collapsedProjectIds: 'ensemblr_workspace_collapsed_project_ids',
	lastWorkspaceSelection: 'ensemblr_workspace_last_selection',
	orderedProjectIds: 'ensemblr_workspace_ordered_project_ids',
	pinnedWorkspaceIds: 'ensemblr_workspace_pinned_workspace_ids',
	rightSidebarCollapsed: 'ensemblr_workspace_right_sidebar_collapsed',
	rightSidebarSizePercent: 'ensemblr_workspace_right_sidebar_size_percent',
	sessionVisitOrderByWorkspace:
		'ensemblr_workspace_session_visit_order_by_workspace',
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

function withLoadedTerminals(
	workspace: WorkspaceShellModel,
	...ids: TerminalDockTabId[]
): WorkspaceShellModel {
	return {
		...workspace,
		dockTabs: [
			...workspace.dockTabs,
			...ids.map((id) => ({
				id,
				kind: 'terminal' as const,
				label: 'Terminal',
				sessionStatus: 'running' as const,
				status: 'idle' as const,
				terminalId: id.slice('terminal:'.length),
			})),
		],
		terminalTabsLoaded: true,
	};
}

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'localStorage');
	Reflect.deleteProperty(globalThis, 'window');
});

test('hydrates workspace navigation atoms from localStorage when mounted', () => {
	installLocalStorage({
		[STORAGE_KEYS.activeChatTabByWorkspace]: JSON.stringify({
			'workspace-a': 'session-a',
		}),
		[STORAGE_KEYS.activeDockTabByWorkspace]: JSON.stringify({
			'workspace-a': 'run',
		}),
		[STORAGE_KEYS.activeReviewTabByWorkspace]: JSON.stringify({
			'workspace-a': 'checks',
		}),
		[STORAGE_KEYS.changesViewMode]: JSON.stringify('folders'),
		[STORAGE_KEYS.collapsedProjectIds]: JSON.stringify(['project-a']),
		[STORAGE_KEYS.lastWorkspaceSelection]: JSON.stringify({
			projectId: 'project-a',
			workspaceId: 'workspace-a',
		}),
		[STORAGE_KEYS.orderedProjectIds]: JSON.stringify([
			'project-b',
			'project-a',
		]),
		[STORAGE_KEYS.pinnedWorkspaceIds]: JSON.stringify(['workspace-a']),
		[STORAGE_KEYS.rightSidebarCollapsed]: JSON.stringify(true),
		[STORAGE_KEYS.rightSidebarSizePercent]: JSON.stringify(48),
		[STORAGE_KEYS.sessionVisitOrderByWorkspace]: JSON.stringify({
			'workspace-a': ['session-a', 'session-b'],
		}),
	});

	const store = createStore();
	const unsubscribes = [
		store.sub(activeChatTabByWorkspaceAtom, () => undefined),
		store.sub(activeDockTabByWorkspaceAtom, () => undefined),
		store.sub(activeReviewTabByWorkspaceAtom, () => undefined),
		store.sub(changesViewModeAtom, () => undefined),
		store.sub(lastWorkspaceSelectionAtom, () => undefined),
		store.sub(orderedProjectIdsAtom, () => undefined),
		store.sub(collapsedProjectIdsAtom, () => undefined),
		store.sub(pinnedWorkspaceIdsAtom, () => undefined),
		store.sub(rightSidebarCollapsedAtom, () => undefined),
		store.sub(rightSidebarSizePercentAtom, () => undefined),
		store.sub(sessionVisitOrderByWorkspaceAtom, () => undefined),
	];

	try {
		expect(store.get(activeChatTabByWorkspaceAtom)).toEqual({
			'workspace-a': 'session-a',
		});
		expect(store.get(activeDockTabByWorkspaceAtom)).toEqual({
			'workspace-a': 'run',
		});
		expect(store.get(activeReviewTabByWorkspaceAtom)).toEqual({
			'workspace-a': 'checks',
		});
		expect(store.get(changesViewModeAtom)).toBe('folders');
		expect(store.get(lastWorkspaceSelectionAtom)).toEqual({
			projectId: 'project-a',
			workspaceId: 'workspace-a',
		});
		expect(store.get(orderedProjectIdsAtom)).toEqual([
			'project-b',
			'project-a',
		]);
		expect(store.get(collapsedProjectIdsAtom)).toEqual(['project-a']);
		expect(store.get(pinnedWorkspaceIdsAtom)).toEqual(['workspace-a']);
		expect(store.get(rightSidebarCollapsedAtom)).toBe(true);
		expect(store.get(rightSidebarSizePercentAtom)).toBe(48);
		expect(store.get(sessionVisitOrderByWorkspaceAtom)).toEqual({
			'workspace-a': ['session-a', 'session-b'],
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

	store.set(activeChatTabByWorkspaceAtom, { 'workspace-b': 'session-b' });
	store.set(activeDockTabByWorkspaceAtom, { 'workspace-b': 'terminal:logs' });
	store.set(activeReviewTabByWorkspaceAtom, { 'workspace-b': 'files' });
	store.set(changesViewModeAtom, 'folders');
	store.set(lastWorkspaceSelectionAtom, {
		projectId: 'project-b',
		workspaceId: 'workspace-b',
	});
	store.set(orderedProjectIdsAtom, ['project-a', 'project-b']);
	store.set(collapsedProjectIdsAtom, ['project-b']);
	store.set(pinnedWorkspaceIdsAtom, ['workspace-b']);
	store.set(rightSidebarCollapsedAtom, true);
	store.set(rightSidebarSizePercentAtom, 52);
	store.set(sessionVisitOrderByWorkspaceAtom, {
		'workspace-b': ['session-b', 'session-a'],
	});

	expect(storage.getItem(STORAGE_KEYS.activeChatTabByWorkspace)).toBe(
		JSON.stringify({ 'workspace-b': 'session-b' }),
	);
	expect(storage.getItem(STORAGE_KEYS.activeDockTabByWorkspace)).toBe(
		JSON.stringify({ 'workspace-b': 'terminal:logs' }),
	);
	expect(storage.getItem(STORAGE_KEYS.activeReviewTabByWorkspace)).toBe(
		JSON.stringify({ 'workspace-b': 'files' }),
	);
	expect(storage.getItem(STORAGE_KEYS.changesViewMode)).toBe(
		JSON.stringify('folders'),
	);
	expect(storage.getItem(STORAGE_KEYS.lastWorkspaceSelection)).toBe(
		JSON.stringify({
			projectId: 'project-b',
			workspaceId: 'workspace-b',
		}),
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
	expect(storage.getItem(STORAGE_KEYS.sessionVisitOrderByWorkspace)).toBe(
		JSON.stringify({ 'workspace-b': ['session-b', 'session-a'] }),
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
	// The strip has loaded, so a preference naming none of its tabs is a closed
	// terminal and falls through.
	const withOpenTerminal = withLoadedTerminals(workspace, 'terminal:other');
	expect(
		getPreferredDockTab({
			dockTabsByWorkspace: { [workspace.id]: 'terminal:missing' },
			workspace: withOpenTerminal,
		}),
	).toBe('setup');
	// A closed terminal falls back to the dock tab visited before it, not Setup.
	expect(
		getPreferredDockTab({
			dockTabsByWorkspace: { [workspace.id]: 'terminal:missing' },
			visitOrder: ['terminal:missing', 'run', 'setup'],
			workspace: withOpenTerminal,
		}),
	).toBe('run');
	// A valid route dock tab overrides the stored per-workspace preference.
	expect(
		getPreferredDockTab({
			dockTabsByWorkspace: { [workspace.id]: 'run' },
			routeDockTab: 'setup',
			workspace,
		}),
	).toBe('setup');
});

// Switching workspaces used to land on Setup and overwrite the remembered
// terminal with it: a workspace's terminal sessions are listed asynchronously
// and are absent entirely from the shell model behind a sidebar link, so the
// preference matched nothing at the moment it was resolved.
test('holds a remembered terminal tab while the strip has not loaded', () => {
	const workspace = getDefaultWorkspace();

	expect(
		getPreferredDockTab({
			dockTabsByWorkspace: { [workspace.id]: 'terminal:pending' },
			workspace,
		}),
	).toBe('terminal:pending');
	// Held over the visit fallback too — that fallback is for a terminal that is
	// gone, and this one has not had the chance to appear.
	expect(
		getPreferredDockTab({
			dockTabsByWorkspace: { [workspace.id]: 'terminal:pending' },
			visitOrder: ['terminal:pending', 'run', 'setup'],
			workspace,
		}),
	).toBe('terminal:pending');
	expect(
		getPreferredDockTab({
			dockTabsByWorkspace: {},
			routeDockTab: 'terminal:pending',
			workspace,
		}),
	).toBe('terminal:pending');
});

// The hold ends when the strip does. Gating it on an empty strip instead would
// hold the dead id for the whole life of a workspace with no terminal open —
// an ordinary steady state — and the dock would render Setup over a preference
// nothing could ever satisfy.
test('releases a remembered terminal tab once the strip has loaded without it', () => {
	const workspace = withLoadedTerminals(getDefaultWorkspace());

	expect(
		getPreferredDockTab({
			dockTabsByWorkspace: { [workspace.id]: 'terminal:closed' },
			visitOrder: ['terminal:closed', 'run', 'setup'],
			workspace,
		}),
	).toBe('run');
	expect(
		getPreferredDockTab({
			dockTabsByWorkspace: {},
			routeDockTab: 'terminal:closed',
			workspace,
		}),
	).toBe('setup');
});

// A dock restore relaunches terminals serially, so the strip carries the first
// one while later ones are still arriving. Gating the hold on "some terminal is
// present" would release the preference mid-restore and let the caller persist
// a substitute over it.
test('holds a remembered terminal tab while a restore is still relaunching', () => {
	const workspace = getDefaultWorkspace();
	const midRestore = {
		...withLoadedTerminals(workspace, 'terminal:first'),
		terminalTabsLoaded: false,
	};

	expect(
		getPreferredDockTab({
			dockTabsByWorkspace: { [workspace.id]: 'terminal:second' },
			visitOrder: ['terminal:second', 'run', 'setup'],
			workspace: midRestore,
		}),
	).toBe('terminal:second');
});

test('resolves the remembered chat tab per workspace', () => {
	const workspace = getDefaultWorkspace();
	const [firstSession, secondSession] = workspace.sessions;

	expect(
		getPreferredChatId({
			chatTabsByWorkspace: {},
			workspace,
		}),
	).toBe(firstSession.id);
	expect(
		getPreferredChatId({
			chatTabsByWorkspace: { [workspace.id]: secondSession.id },
			workspace,
		}),
	).toBe(secondSession.id);
	expect(
		getPreferredChatId({
			chatTabsByWorkspace: { [workspace.id]: 'database-tab-id' },
			workspace,
		}),
	).toBe('database-tab-id');
	expect(
		getPreferredChatId({
			chatTabsByWorkspace: { [workspace.id]: secondSession.id },
			routeChatId: firstSession.id,
			workspace,
		}),
	).toBe(firstSession.id);
	expect(
		getPreferredChatId({
			chatTabsByWorkspace: {},
			visitOrder: ['visited-recently', 'visited-before'],
			workspace,
		}),
	).toBe('visited-recently');
	expect(
		getPreferredChatId({
			chatTabsByWorkspace: { [workspace.id]: secondSession.id },
			visitOrder: ['visited-recently'],
			workspace,
		}),
	).toBe(secondSession.id);
});
