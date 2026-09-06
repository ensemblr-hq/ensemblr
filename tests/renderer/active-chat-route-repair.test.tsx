// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
	resolveChatRouteRepair,
	useChatRouteRepair,
} from '@/renderer/state/workspace/active-chat-route-repair';
import { activeChatTabByWorkspaceAtom } from '@/renderer/state/workspace/selection-atoms';
import type { SessionTabModel } from '@/renderer/types/workbench';

import { installLocalStorage } from './support/dom';

const WORKSPACE_ID = 'workspace-a';

/** Builds the strip tab model the repair hook reads ids off. */
function openTab(id: string): SessionTabModel {
	return {
		agentSessionId: null,
		chatTabId: id,
		id,
		isPreview: false,
		isSubAgent: false,
		kind: 'chat',
		label: id,
		status: 'idle',
		summary: '',
		updatedLabel: '',
	};
}

describe('resolveChatRouteRepair', () => {
	test('leaves a route alone once its chat id resolves', () => {
		expect(
			resolveChatRouteRepair({
				hasSettledTabList: true,
				openTabIds: ['tab-1', 'tab-2'],
				resolvedChatId: 'tab-2',
				visitOrder: ['tab-1'],
			}),
		).toBeNull();
	});

	// A mid-refetch snapshot reads as empty, and repairing off it would yank the
	// user onto another tab and back.
	test('waits for the tab list to settle before repairing', () => {
		expect(
			resolveChatRouteRepair({
				hasSettledTabList: false,
				openTabIds: ['tab-1'],
				resolvedChatId: null,
				visitOrder: ['tab-1'],
			}),
		).toBeNull();
	});

	test('repairs onto the most recently visited tab still open', () => {
		expect(
			resolveChatRouteRepair({
				hasSettledTabList: true,
				openTabIds: ['tab-1', 'tab-2', 'tab-3'],
				rememberedChatId: 'tab-1',
				resolvedChatId: null,
				visitOrder: ['closed-tab', 'tab-3', 'tab-1'],
			}),
		).toBe('tab-3');
	});

	test('falls back to the remembered tab when nothing visited is open', () => {
		expect(
			resolveChatRouteRepair({
				hasSettledTabList: true,
				openTabIds: ['tab-1', 'tab-2'],
				rememberedChatId: 'tab-2',
				resolvedChatId: null,
				visitOrder: ['closed-tab'],
			}),
		).toBe('tab-2');
	});

	test('ignores a remembered tab that is no longer open', () => {
		expect(
			resolveChatRouteRepair({
				hasSettledTabList: true,
				openTabIds: ['tab-1', 'tab-2'],
				rememberedChatId: 'closed-tab',
				resolvedChatId: null,
				visitOrder: [],
			}),
		).toBe('tab-1');
	});

	test('reports no target for a workspace whose strip is empty', () => {
		expect(
			resolveChatRouteRepair({
				hasSettledTabList: true,
				openTabIds: [],
				rememberedChatId: 'closed-tab',
				resolvedChatId: null,
				visitOrder: ['closed-tab'],
			}),
		).toBeNull();
	});
});

describe('useChatRouteRepair', () => {
	let store: ReturnType<typeof createStore>;

	beforeEach(() => {
		installLocalStorage();
		store = createStore();
		store.set(activeChatTabByWorkspaceAtom, { [WORKSPACE_ID]: 'tab-2' });
	});

	function renderRepair({
		navigateToChat,
		resolvedChatId = null,
		routedChatId,
	}: {
		navigateToChat: (chatTabId: string) => void;
		resolvedChatId?: string | null;
		routedChatId: string | undefined;
	}) {
		return renderHook(
			(props: {
				resolvedChatId: string | null;
				routedChatId: string | undefined;
			}) =>
				useChatRouteRepair({
					hasSettledTabList: true,
					navigateToChat,
					resolvedChatId: props.resolvedChatId,
					routedChatId: props.routedChatId,
					sessionTabs: [openTab('tab-1'), openTab('tab-2')],
					workspaceId: WORKSPACE_ID,
				}),
			{
				initialProps: { resolvedChatId, routedChatId },
				wrapper: ({ children }: { children: ReactNode }) => (
					<Provider store={store}>{children}</Provider>
				),
			},
		);
	}

	test('routes a dead chat id onto the workspace remembered tab', () => {
		const navigateToChat = vi.fn();

		renderRepair({ navigateToChat, routedChatId: `${WORKSPACE_ID}:overview` });

		expect(navigateToChat).toHaveBeenCalledExactlyOnceWith('tab-2');
	});

	// The layout above re-renders on every router-state notification, and an
	// effect that re-fires per render is what froze the app the last time this
	// route redirected itself.
	test('attempts one repair per routed id however often it re-renders', () => {
		const navigateToChat = vi.fn();
		const { rerender } = renderRepair({
			navigateToChat,
			routedChatId: 'dead-tab',
		});

		rerender({ resolvedChatId: null, routedChatId: 'dead-tab' });
		rerender({ resolvedChatId: null, routedChatId: 'dead-tab' });

		expect(navigateToChat).toHaveBeenCalledTimes(1);
	});

	test('repairs a routed id that resolved and then went stale', () => {
		const navigateToChat = vi.fn();
		const { rerender } = renderRepair({
			navigateToChat,
			resolvedChatId: 'tab-1',
			routedChatId: 'tab-1',
		});

		rerender({ resolvedChatId: null, routedChatId: 'tab-1' });

		expect(navigateToChat).toHaveBeenCalledExactlyOnceWith('tab-2');
	});

	// The one-shot guard is per routed id, not a lockout: a second tab going
	// away after the first repair has to be repaired too.
	test('repairs a second, different dead routed id', () => {
		const navigateToChat = vi.fn();
		const { rerender } = renderRepair({
			navigateToChat,
			routedChatId: 'dead-tab',
		});

		rerender({ resolvedChatId: null, routedChatId: 'another-dead-tab' });

		expect(navigateToChat.mock.calls).toEqual([['tab-2'], ['tab-2']]);
	});

	// `useActiveWorkspaceChatId` returns undefined on purpose while a
	// workspace-to-workspace transition is pending, and repairing off that would
	// navigate back into the workspace the user is leaving.
	test('leaves a route carrying no chat id alone', () => {
		const navigateToChat = vi.fn();

		renderRepair({ navigateToChat, routedChatId: undefined });

		expect(navigateToChat).not.toHaveBeenCalled();
	});

	test('leaves a resolved route alone', () => {
		const navigateToChat = vi.fn();

		renderRepair({
			navigateToChat,
			resolvedChatId: 'tab-1',
			routedChatId: 'tab-1',
		});

		expect(navigateToChat).not.toHaveBeenCalled();
	});
});
