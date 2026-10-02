// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import { useAgentComposerController } from '../../src/renderer/state/composer';
import {
	appSettingsAtom,
	chatAfkModeAtomFamily,
	chatPlanModeAtomFamily,
} from '../../src/renderer/state/preferences';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config';
import type { AgentModelCatalog } from '../../src/shared/ipc/contracts/agent-models';
import { asModelVendorId } from '../../src/shared/ipc/contracts/agent-models';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const CHAT_TAB_ID = 'chat-afk-exclusivity';
const WORKSPACE_ID = 'workspace-afk-exclusivity';
const MODEL = 'anthropic/claude-sonnet';

const CATALOG: AgentModelCatalog = {
	defaultModelId: MODEL,
	defaultThinkingLevel: 'medium',
	models: [
		{
			agentProvider: 'pi',
			contextWindow: 200_000,
			displayName: 'Claude Sonnet',
			id: MODEL,
			thinkingLevels: ['off', 'medium'],
			vendor: asModelVendorId('anthropic'),
		},
	],
};

/** Renders the controller against an empty workspace, so a submit opens a session. */
function renderComposer() {
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
	const hook = renderHook(
		() =>
			useAgentComposerController({
				chatTabId: CHAT_TAB_ID,
				currentAgentSessionId: null,
				workspaceCwd: '/tmp/workspace-afk-exclusivity',
				workspaceId: WORKSPACE_ID,
			}),
		{ wrapper },
	);
	return { ...hook, store };
}

/** Stubs the bridge and hands back the open spy, which carries the turn snapshot. */
function installBridge() {
	const openAgentSession = vi.fn(async (_request: unknown) => ({
		session: {
			branchId: 'branch-afk',
			closedAt: null,
			createdAt: '2026-09-05T00:00:00.000Z',
			cwd: '/tmp/workspace-afk-exclusivity',
			id: 'session-afk',
			label: null,
			model: MODEL,
			openedTabs: [],
			provider: 'pi' as const,
			runtimeOpen: true,
			runtimeSessionId: 'runtime-afk',
			status: 'idle' as const,
			thinkingLevel: 'medium',
			updatedAt: '2026-09-05T00:00:00.000Z',
			workspaceId: WORKSPACE_ID,
		},
	}));
	installEnsemblrApi({
		listAgentModels: vi.fn(async () => CATALOG),
		listAgentSessions: vi.fn(async () => ({ sessions: [] })),
		onAgentSessionEvent: vi.fn(() => () => undefined),
		openAgentSession,
		submitAgentPrompt: vi.fn(async () => ({
			acceptedAt: '2026-09-05T00:00:01.000Z',
			turnId: 'turn-1',
		})),
	});
	return { openAgentSession };
}

afterEach(() => {
	clearEnsemblrApi();
});

describe('composer AFK and Plan Mode are mutually exclusive', () => {
	test('switching AFK on switches Plan Mode off', () => {
		const { result, store } = renderComposer();
		act(() => {
			result.current.onPlanModeChange(true);
		});

		act(() => {
			result.current.onAfkModeChange(true);
		});

		expect(result.current.afkMode).toBe(true);
		expect(result.current.planMode).toBe(false);
		expect(store.get(chatPlanModeAtomFamily(CHAT_TAB_ID))).toBe(false);
	});

	test('switching Plan Mode on switches AFK off', () => {
		const { result, store } = renderComposer();
		act(() => {
			result.current.onAfkModeChange(true);
		});

		act(() => {
			result.current.onPlanModeChange(true);
		});

		expect(result.current.planMode).toBe(true);
		expect(result.current.afkMode).toBe(false);
		expect(store.get(chatAfkModeAtomFamily(CHAT_TAB_ID))).toBe(false);
	});

	// Switching one OFF says nothing about the other, so it must not turn its
	// sibling on by implication.
	test('switching either off leaves the other alone', () => {
		const { result } = renderComposer();
		act(() => {
			result.current.onAfkModeChange(false);
		});
		act(() => {
			result.current.onPlanModeChange(false);
		});

		expect(result.current.afkMode).toBe(false);
		expect(result.current.planMode).toBe(false);
	});
});

describe('composer AFK rides the turn', () => {
	// `null` is "the user has never decided for this tab", which is deliberately
	// distinct from `false`: a chat that inherited AFK from an unattended parent
	// would otherwise be cleared by the user's first message into it.
	test('omits the flag entirely until the user decides', async () => {
		const { openAgentSession } = installBridge();
		const { result } = renderComposer();

		await act(async () => {
			await result.current.onSubmit('go');
		});

		expect(openAgentSession).toHaveBeenCalledOnce();
		expect(openAgentSession.mock.calls[0][0]).not.toHaveProperty('afkMode');
	});

	test('carries the flag once the chip is on', async () => {
		const { openAgentSession } = installBridge();
		const { result } = renderComposer();
		act(() => {
			result.current.onAfkModeChange(true);
		});

		await act(async () => {
			await result.current.onSubmit('go');
		});

		expect(openAgentSession.mock.calls[0][0]).toMatchObject({
			afkMode: true,
			planMode: false,
		});
	});
});
