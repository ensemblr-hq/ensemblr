// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { act } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const { listChatTabs, navigate, navigateToWorkspace, onFocusChatRequested } =
	vi.hoisted(() => ({
		listChatTabs: vi.fn(),
		navigate: vi.fn(),
		navigateToWorkspace: vi.fn(),
		onFocusChatRequested: vi.fn(),
	}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	listChatTabsQuery: (workspaceId: string) => ({
		queryFn: () => listChatTabs(workspaceId),
		queryKey: ['chat-tabs', workspaceId],
	}),
}));

import { NotificationFocusBridge } from '../../src/renderer/components/workbench-shell/route-layout/notification-focus-bridge';
import { WorkbenchLayoutModelProvider } from '../../src/renderer/components/workbench-shell/shell-contexts';
import { shellFixtureProjects } from '../../src/renderer/fixtures/workbench';
import type { WorkbenchLayoutModel } from '../../src/renderer/types/workbench-shell';
import type { FocusChatBroadcast } from '../../src/shared/ipc/contracts/notifications';
import { createTestQueryClient } from './support/dom';

const project = shellFixtureProjects[0];
const workspace = project.workspaces[0];

const layoutModel = {
	displayProjects: shellFixtureProjects,
	navigateToWorkspace,
	resolveWorkspaceRouteSearch: () => ({ dock: 'setup', review: 'files' }),
} as unknown as WorkbenchLayoutModel;

/**
 * Mounts the bridge and hands back the listener it registered, so a case can
 * fire a notification click the way the main process would.
 */
function mountBridge(): (payload: FocusChatBroadcast) => void {
	const client = createTestQueryClient();
	const store = createStore();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>
			<QueryClientProvider client={client}>
				<WorkbenchLayoutModelProvider value={layoutModel}>
					{children}
				</WorkbenchLayoutModelProvider>
			</QueryClientProvider>
		</Provider>
	);
	render(<NotificationFocusBridge />, { wrapper });
	return onFocusChatRequested.mock.calls[0][0];
}

beforeEach(() => {
	listChatTabs.mockReset();
	navigate.mockReset();
	navigateToWorkspace.mockReset();
	onFocusChatRequested.mockReset();
	onFocusChatRequested.mockReturnValue(() => undefined);
	window.ensemblr = { onFocusChatRequested } as never;
	window.localStorage?.clear();
});

test('opens the chat a clicked notification names', async () => {
	const click = mountBridge();
	await act(async () => {
		click({
			agentSessionId: 'session-7',
			chatTabId: 'tab-7',
			workspaceId: workspace.id,
		});
	});

	expect(navigate).toHaveBeenCalledWith({
		params: {
			chatId: 'tab-7',
			projectId: project.id,
			workspaceId: workspace.id,
		},
		search: { dock: 'setup', review: 'files' },
		to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
	});
});

test('resolves the tab itself when main could not', async () => {
	listChatTabs.mockResolvedValue({
		closed: [],
		open: [{ agentSessionId: 'session-7', id: 'tab-7' }],
	});
	const click = mountBridge();
	await act(async () => {
		click({
			agentSessionId: 'session-7',
			chatTabId: null,
			workspaceId: workspace.id,
		});
	});

	expect(listChatTabs).toHaveBeenCalledWith(workspace.id);
	expect(navigate.mock.calls[0][0].params.chatId).toBe('tab-7');
});

test('falls back to the workspace when the tab is gone', async () => {
	listChatTabs.mockResolvedValue({ closed: [], open: [] });
	const click = mountBridge();
	await act(async () => {
		click({
			agentSessionId: 'session-7',
			chatTabId: null,
			workspaceId: workspace.id,
		});
	});

	expect(navigate).not.toHaveBeenCalled();
	expect(navigateToWorkspace).toHaveBeenCalledWith(project.id, workspace.id);
});

test('unsubscribes on unmount', () => {
	const unsubscribe = vi.fn();
	onFocusChatRequested.mockReturnValue(unsubscribe);
	const client = createTestQueryClient();
	const store = createStore();
	const view = render(
		<Provider store={store}>
			<QueryClientProvider client={client}>
				<WorkbenchLayoutModelProvider value={layoutModel}>
					<NotificationFocusBridge />
				</WorkbenchLayoutModelProvider>
			</QueryClientProvider>
		</Provider>,
	);
	view.unmount();

	expect(unsubscribe).toHaveBeenCalled();
});
