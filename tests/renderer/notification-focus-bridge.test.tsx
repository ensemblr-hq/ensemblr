// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { act } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const { listChatTabs, navigate, navigateToWorkspace } = vi.hoisted(() => ({
	listChatTabs: vi.fn(),
	navigate: vi.fn(),
	navigateToWorkspace: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

// The jump the bridge reuses refuses an archiving workspace, which it reads
// through the workspace-state barrel — and that pulls the shared query client in
// with it, so the mock has to carry the key factory it reads at import time.
vi.mock('@/renderer/api/ensemblr-queries', () => ({
	ensemblrQueryKeys: {
		agentModels: () => ['agent-models'],
		health: () => ['health'],
		repositoryWorkspaceNavigation: () => ['repository-workspace-navigation'],
		reviewComments: (workspaceId: string) => ['review-comments', workspaceId],
		workspaceOpenTargets: () => ['workspace-open-targets'],
	},
	listChatTabsQuery: (workspaceId: string) => ({
		queryFn: () => listChatTabs(workspaceId),
		queryKey: ['chat-tabs', workspaceId],
	}),
}));

import { Toaster } from '../../src/renderer/components/ui/sonner';
import { NotificationFocusBridge } from '../../src/renderer/components/workbench-shell/route-layout/notification-focus-bridge';
import { WorkbenchLayoutModelProvider } from '../../src/renderer/components/workbench-shell/shell-contexts';
import { shellFixtureProjects } from '../../src/renderer/fixtures/workbench';
import { useAskUserQuestionToast } from '../../src/renderer/hooks/ask-user-question/use-ask-user-question-toast';
import { i18n } from '../../src/renderer/lib/i18n';
import { pendingAskUserQuestionsAtom } from '../../src/renderer/state/ask-user-question';
import { pendingNotificationFocusAtom } from '../../src/renderer/state/unread';
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

/** Mounts the bridge over a store a case can park a focus request in. */
function mountBridge(
	store = createStore(),
	content = <NotificationFocusBridge />,
) {
	const client = createTestQueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<Provider store={store}>
			<QueryClientProvider client={client}>
				<WorkbenchLayoutModelProvider value={layoutModel}>
					{children}
				</WorkbenchLayoutModelProvider>
			</QueryClientProvider>
		</Provider>
	);
	return render(content, { wrapper });
}

/** Parks the chat a clicked notification named, the way the root sync does. */
async function park(
	store: ReturnType<typeof createStore>,
	payload: FocusChatBroadcast,
): Promise<void> {
	await act(async () => {
		store.set(pendingNotificationFocusAtom, payload);
	});
}

beforeEach(() => {
	listChatTabs.mockReset();
	navigate.mockReset();
	navigateToWorkspace.mockReset();
	window.localStorage?.clear();
});

test('opens the chat a clicked notification names', async () => {
	const store = createStore();
	mountBridge(store);
	await park(store, {
		agentSessionId: 'session-7',
		chatTabId: 'tab-7',
		workspaceId: workspace.id,
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
	expect(store.get(pendingNotificationFocusAtom)).toBeNull();
});

test('drains a request parked before the shell mounted', async () => {
	const store = createStore();
	store.set(pendingNotificationFocusAtom, {
		agentSessionId: 'session-7',
		chatTabId: 'tab-7',
		workspaceId: workspace.id,
	});
	await act(async () => {
		mountBridge(store);
	});

	expect(navigate.mock.calls[0][0].params.chatId).toBe('tab-7');
});

test('resolves the tab itself when main could not', async () => {
	listChatTabs.mockResolvedValue({
		closed: [],
		open: [{ agentSessionId: 'session-7', id: 'tab-7' }],
	});
	const store = createStore();
	mountBridge(store);
	await park(store, {
		agentSessionId: 'session-7',
		chatTabId: null,
		workspaceId: workspace.id,
	});

	expect(listChatTabs).toHaveBeenCalledWith(workspace.id);
	expect(navigate.mock.calls[0][0].params.chatId).toBe('tab-7');
});

/** Renders the actual question toast and its cross-workspace navigation bridge. */
function QuestionToastFocusHarness() {
	useAskUserQuestionToast();
	return (
		<>
			<NotificationFocusBridge />
			<Toaster />
		</>
	);
}

test('a question toast stays translated and focuses its chat only after the action is clicked', async () => {
	listChatTabs.mockResolvedValue({
		closed: [],
		open: [{ agentSessionId: 'session-7', id: 'tab-7' }],
	});
	const store = createStore();
	mountBridge(store, <QuestionToastFocusHarness />);
	act(() => {
		store.set(pendingAskUserQuestionsAtom, {
			'session-7': {
				agentSessionId: 'session-7',
				questions: [
					{
						question: 'Which approach should we use?',
						options: [{ label: 'Small change' }, { label: 'Full rewrite' }],
					},
				],
				requestId: 'question-focus-integration',
				workspaceId: workspace.id,
			},
		});
	});
	await screen.findByRole('button', { name: 'Focus chat' });
	for (const { language, title, label } of [
		{ language: 'ru', title: 'Агенту нужен ваш ответ', label: 'Открыть чат' },
		{
			language: 'el',
			title: 'Ο πράκτορας χρειάζεται την απάντησή σας',
			label: 'Άνοιξε τη συνομιλία',
		},
	]) {
		await act(async () => {
			await i18n.changeLanguage(language);
		});
		await screen.findByRole('button', { name: label });
		expect(screen.getByText(title)).toBeInTheDocument();
		expect(screen.getAllByText('Which approach should we use?')).toHaveLength(
			1,
		);
	}
	expect(screen.queryByText('Agent needs your input')).not.toBeInTheDocument();
	expect(navigate).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole('button', { name: 'Άνοιξε τη συνομιλία' }));

	await waitFor(() => {
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
});

test('falls back to the workspace when the tab is gone', async () => {
	listChatTabs.mockResolvedValue({ closed: [], open: [] });
	const store = createStore();
	mountBridge(store);
	await park(store, {
		agentSessionId: 'session-7',
		chatTabId: null,
		workspaceId: workspace.id,
	});

	expect(navigate).not.toHaveBeenCalled();
	expect(navigateToWorkspace).toHaveBeenCalledWith(project.id, workspace.id);
});
