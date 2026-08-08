// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import { useAgentComposerController } from '../../src/renderer/state/composer';
import { appSettingsAtom } from '../../src/renderer/state/preferences';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config';
import type { AgentModelCatalog } from '../../src/shared/ipc/contracts/agent-models';
import type {
	AgentSessionSnapshotWire,
	SubmitAgentPromptRequest,
} from '../../src/shared/ipc/contracts/agent-session';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const SUBMITTING_TAB_ID = 'chat-tab-that-submitted';
const OTHER_TAB_ID = 'chat-tab-opened-while-in-flight';
const WORKSPACE_ID = 'workspace-pending-session-binding';
const OPENED_SESSION_ID = 'session-opened-by-submitting-tab';
const MODEL_ID = 'anthropic/claude-sonnet';
const OTHER_TAB_MODEL_ID = 'anthropic/claude-opus';
const WORKSPACE_CWD = '/tmp/workspace-pending-session-binding';

const CATALOG: AgentModelCatalog = {
	defaultModelId: MODEL_ID,
	defaultThinkingLevel: 'medium',
	models: [
		{
			agentProvider: 'pi',
			contextWindow: 200_000,
			displayName: 'Claude Sonnet',
			id: MODEL_ID,
			provider: 'anthropic',
			thinkingLevels: ['medium'],
		},
		{
			agentProvider: 'pi',
			contextWindow: 1_000_000,
			displayName: 'Claude Opus',
			id: OTHER_TAB_MODEL_ID,
			provider: 'anthropic',
			thinkingLevels: ['high', 'medium'],
		},
	],
};

/** The session `openAgentSession` reports back for the tab that submitted. */
function createOpenedSession(): AgentSessionSnapshotWire {
	return {
		branchId: 'branch-pending-session-binding',
		closedAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		cwd: WORKSPACE_CWD,
		id: OPENED_SESSION_ID,
		label: null,
		model: MODEL_ID,
		openedTabs: [],
		provider: 'pi',
		runtimeOpen: true,
		runtimeSessionId: 'runtime-pending-session-binding',
		status: 'streaming',
		thinkingLevel: 'medium',
		updatedAt: '2026-01-01T00:00:00.000Z',
		workspaceId: WORKSPACE_ID,
	};
}

/**
 * Stubs the bridge with an `openAgentSession` the test resolves by hand, so the
 * window between submitting and the session landing stays open while the active
 * tab changes underneath the route-level controller.
 */
function installDeferredOpenBridge() {
	let release: (() => void) | null = null;
	const openAgentSession = vi.fn(
		() =>
			new Promise<{ session: AgentSessionSnapshotWire }>((resolve) => {
				release = () => resolve({ session: createOpenedSession() });
			}),
	);
	const submitAgentPrompt = vi.fn(
		async (_request: SubmitAgentPromptRequest) => ({
			acceptedAt: '2026-01-01T00:00:01.000Z',
			turnId: 'turn-pending-session-binding',
		}),
	);
	installEnsemblrApi({
		listAgentModels: vi.fn(async () => CATALOG),
		listAgentSessions: vi.fn(async () => ({ sessions: [] })),
		onAgentSessionEvent: vi.fn(() => () => undefined),
		openAgentSession,
		submitAgentPrompt,
	});
	return {
		openAgentSession,
		releaseOpen: () => release?.(),
		submitAgentPrompt,
	};
}

/** Yields to the macrotask queue so an in-flight mutation reaches the bridge. */
function flush(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

/**
 * Renders the route-level composer controller with a swappable `chatTabId`, the
 * way `WorkspaceRouteContent` re-renders it when the user switches tabs.
 */
function renderControllerForTab(
	initialChatTabId: string,
	isResolvingChatTab = false,
) {
	const client = createTestQueryClient();
	client.setQueryData(ensemblrQueryKeys.agentModels(), CATALOG);
	client.setQueryData(
		ensemblrQueryKeys.agentSessionsForWorkspace(WORKSPACE_ID),
		{ sessions: [] },
	);

	const store = createStore();
	store.set(appSettingsAtom, DEFAULT_APP_SETTINGS);
	const wrapper = ({ children }: PropsWithChildren) => (
		<Provider store={store}>
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		</Provider>
	);

	return renderHook(
		({ chatTabId }: { chatTabId: string }) =>
			useAgentComposerController({
				chatTabId,
				currentAgentSessionId: null,
				isResolvingChatTab,
				workspaceCwd: WORKSPACE_CWD,
				workspaceId: WORKSPACE_ID,
			}),
		{ initialProps: { chatTabId: initialChatTabId }, wrapper },
	);
}

afterEach(() => {
	clearEnsemblrApi();
});

describe('agent composer pending-session binding', () => {
	test('a session opened by one tab does not bind to the tab that became active while the open was in flight', async () => {
		const { openAgentSession, releaseOpen } = installDeferredOpenBridge();
		const { rerender, result } = renderControllerForTab(SUBMITTING_TAB_ID);

		let submitted: Promise<void> | undefined;
		await act(async () => {
			submitted = result.current.onSubmit('start the chat');
			await flush();
		});
		expect(openAgentSession).toHaveBeenCalledTimes(1);

		act(() => {
			rerender({ chatTabId: OTHER_TAB_ID });
		});
		releaseOpen();
		await act(async () => {
			await submitted;
		});

		expect(result.current.activeSessionId).toBeNull();
	});

	test('the tab that submitted still resolves the session it opened', async () => {
		const { releaseOpen } = installDeferredOpenBridge();
		const { rerender, result } = renderControllerForTab(SUBMITTING_TAB_ID);

		let submitted: Promise<void> | undefined;
		await act(async () => {
			submitted = result.current.onSubmit('start the chat');
			await flush();
		});
		act(() => {
			rerender({ chatTabId: OTHER_TAB_ID });
		});
		releaseOpen();
		await act(async () => {
			await submitted;
		});

		act(() => {
			rerender({ chatTabId: SUBMITTING_TAB_ID });
		});

		expect(result.current.activeSessionId).toBe(OPENED_SESSION_ID);
	});

	test('an in-flight open leaves the newly active tab’s composer idle', async () => {
		const { releaseOpen } = installDeferredOpenBridge();
		const { rerender, result } = renderControllerForTab(SUBMITTING_TAB_ID);

		let submitted: Promise<void> | undefined;
		await act(async () => {
			submitted = result.current.onSubmit('start the chat');
			await flush();
		});
		expect(result.current.isStreaming).toBe(true);

		act(() => {
			rerender({ chatTabId: OTHER_TAB_ID });
		});
		expect(result.current.isStreaming).toBe(false);

		releaseOpen();
		await act(async () => {
			await submitted;
		});
	});

	test('the first turn is submitted with the picks of the tab that fired it', async () => {
		const { releaseOpen, submitAgentPrompt } = installDeferredOpenBridge();
		const { rerender, result } = renderControllerForTab(SUBMITTING_TAB_ID);

		let submitted: Promise<void> | undefined;
		await act(async () => {
			submitted = result.current.onSubmit('start the chat');
			await flush();
		});

		// The other tab's picks land while the runtime is still spawning; they must
		// not re-stamp the request the submitting tab is midway through.
		act(() => {
			rerender({ chatTabId: OTHER_TAB_ID });
		});
		act(() => {
			result.current.onModelChange(OTHER_TAB_MODEL_ID);
			result.current.onThinkingChange('high');
			result.current.onPlanModeChange(true);
		});
		releaseOpen();
		await act(async () => {
			await submitted;
		});

		expect(submitAgentPrompt).toHaveBeenCalledTimes(1);
		expect(submitAgentPrompt.mock.calls[0]?.[0]).toMatchObject({
			model: MODEL_ID,
			thinkingLevel: 'medium',
		});
		expect(submitAgentPrompt.mock.calls[0]?.[0]).not.toHaveProperty('planMode');
	});

	test('a tab whose row has not loaded yet refuses to open a second session', async () => {
		const { openAgentSession } = installDeferredOpenBridge();
		const { result } = renderControllerForTab(SUBMITTING_TAB_ID, true);

		await act(async () => {
			await result.current.onSubmit('start the chat');
		});

		expect(openAgentSession).not.toHaveBeenCalled();
		expect(result.current.lastError).toBe(
			'Workspace chat tab is still initializing. Try again in a moment.',
		);
	});
});
