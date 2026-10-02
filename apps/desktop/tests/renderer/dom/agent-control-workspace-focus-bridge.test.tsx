// @vitest-environment happy-dom

import { act } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type { FocusViewBroadcast } from '@/shared/agent-control';

const navigateToChat = vi.fn().mockResolvedValue(undefined);
const invalidateWorkspaceListViews = vi.fn().mockResolvedValue(undefined);

// The shell's project tree is a live query, so the bridge has to be told about a
// workspace that appears after the focus request rather than only about the tree
// it saw when the request landed. A real subscribable store is what lets a test
// move that tree under a mounted bridge.
const layoutStore = vi.hoisted(() => {
	let snapshot: { displayProjects: unknown[] } | null = null;
	const listeners = new Set<() => void>();
	return {
		read: () => snapshot,
		set(next: { displayProjects: unknown[] } | null) {
			snapshot = next;
			for (const listener of listeners) {
				listener();
			}
		},
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
});

vi.mock('@/renderer/api/ensemblr', () => ({
	invalidateWorkspaceListViews: (...args: unknown[]) =>
		invalidateWorkspaceListViews(...args),
}));

vi.mock(
	'@/renderer/hooks/workbench-shell/composer/use-navigate-to-last-unread',
	() => ({ useNavigateToLastUnread: () => navigateToChat }),
);

vi.mock('@/renderer/components/workbench-shell/shell-contexts', () => ({
	useWorkbenchLayoutRouteModelOptional: () =>
		useSyncExternalStore(layoutStore.subscribe, layoutStore.read),
}));

import { AgentControlWorkspaceFocusBridge } from '@/renderer/components/workbench-shell/route-layout/agent-control-workspace-focus-bridge';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from '../support/dom';

/** Puts a project tree holding exactly the workspaces named in front of the bridge. */
function setTree(...workspaceIds: string[]): void {
	act(() =>
		layoutStore.set({
			displayProjects: [
				{
					id: 'repo-1',
					name: 'Bruckner',
					workspaces: workspaceIds.map((id) => ({ id, name: id })),
				},
			] as unknown as ProjectShellModel[],
		}),
	);
}

/** Mounts the bridge and returns the broadcast the control channel sends it. */
function mountBridge(): (payload: FocusViewBroadcast) => void {
	let listener: ((payload: FocusViewBroadcast) => void) | null = null;
	installEnsemblrApi({
		onAgentControlFocusView: (
			handler: (payload: FocusViewBroadcast) => void,
		) => {
			listener = handler;
			return () => {
				listener = null;
			};
		},
	});
	renderWithProviders(<AgentControlWorkspaceFocusBridge />);
	return (payload) => {
		act(() => listener?.(payload));
	};
}

const focusWorkspace = (workspaceId: string): FocusViewBroadcast => ({
	target: { kind: 'workspace' },
	workspaceId,
});

describe('the cross-workspace focus bridge', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearEnsemblrApi();
		layoutStore.set(null);
	});

	test('jumps to a workspace the shell already lists', () => {
		const broadcast = mountBridge();
		setTree('ws-a');

		broadcast(focusWorkspace('ws-a'));

		expect(navigateToChat).toHaveBeenCalledWith({ workspaceId: 'ws-a' });
	});

	// The refetch buys a workspace that is not in the tree yet. Spending it on one
	// that is refetches every list view for a jump that lands on the next render
	// regardless.
	test('does not ask for the tree again when the workspace is listed', () => {
		const broadcast = mountBridge();
		setTree('ws-a');

		broadcast(focusWorkspace('ws-a'));

		expect(invalidateWorkspaceListViews).not.toHaveBeenCalled();
	});

	// The Concierge cuts a workspace and focuses it in the same breath, and the
	// shell's tree only refetches on a poll — so at the moment the request lands
	// the workspace it names is usually not in the tree at all.
	test('asks for the tree afresh and lands once the workspace appears', () => {
		const broadcast = mountBridge();
		setTree('ws-a');

		broadcast(focusWorkspace('ws-new'));

		expect(invalidateWorkspaceListViews).toHaveBeenCalled();
		expect(navigateToChat).not.toHaveBeenCalled();

		setTree('ws-a', 'ws-new');

		expect(navigateToChat).toHaveBeenCalledWith({ workspaceId: 'ws-new' });
	});

	// One request at a time, and it retires when it lands: a tree that changes
	// again later must not navigate a second time off the same broadcast.
	test('lands a request once', () => {
		const broadcast = mountBridge();
		setTree('ws-a');

		broadcast(focusWorkspace('ws-a'));
		setTree('ws-a', 'ws-b');

		expect(navigateToChat).toHaveBeenCalledTimes(1);
	});

	// A workspace that never arrives — the create failed after the broadcast, or it
	// is archived — must not leave the request armed: the user has moved on, and a
	// jump fired minutes later off a poll reads as the app losing their place.
	test('drops a request whose workspace never arrives', () => {
		vi.useFakeTimers();
		try {
			const broadcast = mountBridge();
			setTree('ws-a');

			broadcast(focusWorkspace('ws-new'));
			act(() => vi.advanceTimersByTime(30_000));
			setTree('ws-a', 'ws-new');

			expect(navigateToChat).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	test('ignores a focus aimed at a surface inside a workspace', () => {
		const broadcast = mountBridge();
		setTree('ws-a');

		broadcast({
			target: { kind: 'panel', panel: 'changes' },
			workspaceId: 'ws-a',
		});

		expect(navigateToChat).not.toHaveBeenCalled();
		expect(invalidateWorkspaceListViews).not.toHaveBeenCalled();
	});
});
