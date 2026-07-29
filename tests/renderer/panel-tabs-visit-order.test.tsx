// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test } from 'vitest';

import { getDefaultWorkspace } from '@/renderer/fixtures/workbench';
import { dockVisitOrderByWorkspaceAtom } from '@/renderer/state/workspace/layout-atoms';
import { useWorkspacePanelTabState } from '@/renderer/state/workspace/panel-tabs';
import { sessionVisitOrderByWorkspaceAtom } from '@/renderer/state/workspace/selection-atoms';
import type {
	DockTabModel,
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

const TERMINAL_TAB: DockTabModel = {
	id: 'terminal:1',
	kind: 'terminal',
	label: 'Terminal',
	sessionStatus: 'running',
	status: 'running',
	terminalId: 'terminal-1',
};

function withTerminalTab(workspace: WorkspaceShellModel): WorkspaceShellModel {
	return { ...workspace, dockTabs: [...workspace.dockTabs, TERMINAL_TAB] };
}

function renderPanelTabs(
	store: ReturnType<typeof createStore>,
	initial: {
		activeChatId?: string;
		activeWorkspace: WorkspaceShellModel;
		search?: WorkbenchRouteSearch;
	},
) {
	return renderHook(
		(props: typeof initial) => useWorkspacePanelTabState(props),
		{
			initialProps: initial,
			wrapper: ({ children }: { children: ReactNode }) => (
				<Provider store={store}>{children}</Provider>
			),
		},
	);
}

describe('useWorkspacePanelTabState visit tracking', () => {
	let store: ReturnType<typeof createStore>;
	let workspace: WorkspaceShellModel;

	beforeEach(() => {
		store = createStore();
		workspace = getDefaultWorkspace();
	});

	test('records each visited chat tab, most recent first', () => {
		const { rerender } = renderPanelTabs(store, {
			activeChatId: 'chat-1',
			activeWorkspace: workspace,
		});

		rerender({ activeChatId: 'chat-2', activeWorkspace: workspace });
		rerender({ activeChatId: 'chat-3', activeWorkspace: workspace });
		rerender({ activeChatId: 'chat-1', activeWorkspace: workspace });

		expect(store.get(sessionVisitOrderByWorkspaceAtom)).toEqual({
			[workspace.id]: ['chat-1', 'chat-3', 'chat-2'],
		});
	});

	test('leaves the chat history untouched while no chat tab is active', () => {
		renderPanelTabs(store, { activeWorkspace: workspace });

		expect(store.get(sessionVisitOrderByWorkspaceAtom)).toEqual({});
	});

	test('records each visited dock tab, most recent first', () => {
		const activeWorkspace = withTerminalTab(workspace);
		const { rerender } = renderPanelTabs(store, {
			activeWorkspace,
			search: { dock: 'setup' },
		});

		rerender({ activeWorkspace, search: { dock: 'run' } });
		rerender({ activeWorkspace, search: { dock: 'terminal:1' } });

		expect(store.get(dockVisitOrderByWorkspaceAtom)).toEqual({
			[workspace.id]: ['terminal:1', 'run', 'setup'],
		});
	});

	test('lands on the previously visited dock tab when the active terminal closes', () => {
		const withTerminal = withTerminalTab(workspace);
		const { rerender, result } = renderPanelTabs(store, {
			activeWorkspace: withTerminal,
			search: { dock: 'run' },
		});

		rerender({ activeWorkspace: withTerminal, search: { dock: 'terminal:1' } });
		expect(result.current.activeDockTab).toBe('terminal:1');

		rerender({ activeWorkspace: workspace });

		expect(result.current.activeDockTab).toBe('run');
	});

	test('keeps visit history separate per workspace', () => {
		const otherWorkspace = { ...workspace, id: 'workspace-other' };
		const { rerender } = renderPanelTabs(store, {
			activeChatId: 'chat-1',
			activeWorkspace: workspace,
		});

		rerender({ activeChatId: 'chat-9', activeWorkspace: otherWorkspace });

		expect(store.get(sessionVisitOrderByWorkspaceAtom)).toEqual({
			'workspace-other': ['chat-9'],
			[workspace.id]: ['chat-1'],
		});
	});
});
