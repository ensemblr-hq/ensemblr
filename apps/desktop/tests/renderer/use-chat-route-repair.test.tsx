// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { useChatRouteRepair } from '@/renderer/hooks/workbench-shell/route-layout/use-chat-route-repair';
import { activeChatTabByWorkspaceAtom } from '@/renderer/state/workspace/selection-atoms';
import type { SessionTabModel } from '@/renderer/types/workbench';

import { installLocalStorage } from './support/dom';

const navigateSpy = vi.fn();

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => navigateSpy,
}));

const WORKSPACE_ID = 'workspace-a';
const PROJECT_ID = 'project-a';
const SEARCH = { dock: 'setup', review: 'files' } as const;

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

/** The chat id the hook navigated to on call `index`, or null when it did not. */
function navigatedChatId(index: number): string | null {
	return navigateSpy.mock.calls[index]?.[0]?.params?.chatId ?? null;
}

describe('useChatRouteRepair', () => {
	let store: ReturnType<typeof createStore>;

	beforeEach(() => {
		installLocalStorage();
		navigateSpy.mockClear();
		store = createStore();
		store.set(activeChatTabByWorkspaceAtom, { [WORKSPACE_ID]: 'tab-2' });
	});

	function renderRepair({
		resolvedChatId = null,
		routedChatId,
	}: {
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
					projectId: PROJECT_ID,
					resolvedChatId: props.resolvedChatId,
					routedChatId: props.routedChatId,
					search: SEARCH,
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

	test('replaces a dead chat id with the workspace remembered tab', () => {
		renderRepair({ routedChatId: `${WORKSPACE_ID}:overview` });

		expect(navigateSpy).toHaveBeenCalledExactlyOnceWith({
			params: {
				chatId: 'tab-2',
				projectId: PROJECT_ID,
				workspaceId: WORKSPACE_ID,
			},
			replace: true,
			search: SEARCH,
			to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
		});
	});

	// The layout above re-renders on every router-state notification, and an
	// effect that re-fires per render is what froze the app the last time this
	// route redirected itself.
	test('attempts one repair per routed id however often it re-renders', () => {
		const { rerender } = renderRepair({ routedChatId: 'dead-tab' });

		rerender({ resolvedChatId: null, routedChatId: 'dead-tab' });
		rerender({ resolvedChatId: null, routedChatId: 'dead-tab' });

		expect(navigateSpy).toHaveBeenCalledTimes(1);
	});

	test('repairs a routed id that resolved and then went stale', () => {
		const { rerender } = renderRepair({
			resolvedChatId: 'tab-1',
			routedChatId: 'tab-1',
		});

		rerender({ resolvedChatId: null, routedChatId: 'tab-1' });

		expect(navigateSpy).toHaveBeenCalledTimes(1);
		expect(navigatedChatId(0)).toBe('tab-2');
	});

	// The one-shot guard is per routed id, not a lockout: a second tab going
	// away after the first repair has to be repaired too.
	test('repairs a second, different dead routed id', () => {
		const { rerender } = renderRepair({ routedChatId: 'dead-tab' });

		rerender({ resolvedChatId: null, routedChatId: 'another-dead-tab' });

		expect(navigateSpy).toHaveBeenCalledTimes(2);
		expect([navigatedChatId(0), navigatedChatId(1)]).toEqual([
			'tab-2',
			'tab-2',
		]);
	});

	// `useActiveWorkspaceChatId` returns undefined on purpose while a
	// workspace-to-workspace transition is pending, and repairing off that would
	// navigate back into the workspace the user is leaving.
	test('leaves a route carrying no chat id alone', () => {
		renderRepair({ routedChatId: undefined });

		expect(navigateSpy).not.toHaveBeenCalled();
	});

	test('leaves a resolved route alone', () => {
		renderRepair({ resolvedChatId: 'tab-1', routedChatId: 'tab-1' });

		expect(navigateSpy).not.toHaveBeenCalled();
	});
});
