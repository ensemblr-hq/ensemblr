// @vitest-environment happy-dom

/**
 * Dragging a tab pins it out of the preview slot, because placing a tab
 * deliberately means keeping it. A preview tab the drag only pushed aside keeps
 * its slot — its index moved, the user's intent did not.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';

import { useSessionTabState } from '../../src/renderer/state/workspace';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '../../src/renderer/types/workbench';
import type { ChatTabWire } from '../../src/shared/ipc/contracts/chat-tab';
import { createTestQueryClient, installEnsemblrApi } from './support/dom';

const WORKSPACE_ID = 'ws-1';

function chatTabWire(
	id: string,
	position: number,
	isPreview: boolean,
): ChatTabWire {
	return {
		closedAt: null,
		fullTitle: id,
		id,
		isPreview,
		kind: isPreview ? 'file' : 'chat',
		metadata: isPreview ? { filePath: `src/${id}.ts` } : {},
		openedAt: `2026-07-11T00:00:0${position}.000Z`,
		piSessionId: null,
		position,
		title: id,
		workspaceId: WORKSPACE_ID,
	};
}

const OPEN_TABS = [
	chatTabWire('chat', 0, false),
	chatTabWire('preview', 1, true),
	chatTabWire('doc', 2, false),
];

const activeSession: SessionTabModel = {
	chatTabId: 'chat',
	id: 'chat',
	isPreview: false,
	isSubAgent: false,
	kind: 'chat',
	label: 'Chat',
	piSessionId: null,
	status: 'idle',
	summary: '',
	updatedLabel: 'Chat',
};

const activeWorkspace = {
	id: WORKSPACE_ID,
	sessions: [activeSession],
} as unknown as WorkspaceShellModel;

function renderTabState() {
	const pinChatTab = vi.fn(async ({ chatTabId }: { chatTabId: string }) => ({
		tab: { ...chatTabWire(chatTabId, 1, false) },
	}));
	const reorderChatTabs = vi.fn(async () => ({ open: OPEN_TABS }));
	installEnsemblrApi({
		listChatTabs: async () => ({ closed: [], open: OPEN_TABS }),
		listClosedChatTabsWithSummary: async () => ({ closed: [] }),
		listPiSessions: async () => ({ sessions: [] }),
		onAgentControlTabsChanged: vi.fn(() => () => undefined),
		onPiSessionEvent: vi.fn(() => () => undefined),
		onTerminalLifecycle: vi.fn(() => () => undefined),
		pinChatTab,
		reorderChatTabs,
	});
	const client = createTestQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const { result } = renderHook(
		() =>
			useSessionTabState({
				activeSession,
				activeWorkspace,
				onSessionTabChange: () => undefined,
			}),
		{ wrapper },
	);
	return { pinChatTab, reorderChatTabs, result };
}

describe('reorderSessionTabs pinning', () => {
	test('pins the preview tab when it is the one dragged', async () => {
		const { pinChatTab, reorderChatTabs, result } = renderTabState();
		await waitFor(() =>
			expect(result.current.sessionTabs.map((tab) => tab.id)).toEqual([
				'chat',
				'preview',
				'doc',
			]),
		);

		result.current.reorderSessionTabs(['preview', 'chat', 'doc'], 'preview');

		await waitFor(() =>
			expect(pinChatTab).toHaveBeenCalledWith({ chatTabId: 'preview' }),
		);
		expect(reorderChatTabs).toHaveBeenCalledWith({
			orderedIds: ['preview', 'chat', 'doc'],
			workspaceId: WORKSPACE_ID,
		});
	});

	test('leaves the preview tab alone when another tab was dragged past it', async () => {
		const { pinChatTab, reorderChatTabs, result } = renderTabState();
		await waitFor(() => expect(result.current.sessionTabs).toHaveLength(3));

		result.current.reorderSessionTabs(['doc', 'chat', 'preview'], 'doc');

		await waitFor(() => expect(reorderChatTabs).toHaveBeenCalled());
		expect(pinChatTab).not.toHaveBeenCalled();
	});

	test('ignores a drag that did not change the order', async () => {
		const { pinChatTab, reorderChatTabs, result } = renderTabState();
		await waitFor(() => expect(result.current.sessionTabs).toHaveLength(3));

		result.current.reorderSessionTabs(['chat', 'preview', 'doc'], 'preview');

		expect(reorderChatTabs).not.toHaveBeenCalled();
		expect(pinChatTab).not.toHaveBeenCalled();
	});
});
