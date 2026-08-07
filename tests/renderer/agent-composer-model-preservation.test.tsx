// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import { useAgentComposerController } from '../../src/renderer/state/composer';
import { appSettingsAtom } from '../../src/renderer/state/preferences';
import type { AgentProviderId } from '../../src/shared/agent-provider';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config';
import type { AgentModelCatalog } from '../../src/shared/ipc/contracts/agent-models';
import type { AgentSessionSnapshotWire } from '../../src/shared/ipc/contracts/agent-session';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const CHAT_TAB_ID = 'chat-model-preservation';
const WORKSPACE_ID = 'workspace-model-preservation';
const SESSION_ID = 'session-model-preservation';
const PENDING_SESSION_ID = 'session-not-yet-in-cache';
const ORIGINAL_MODEL = 'anthropic/claude-sonnet';
const NEW_DEFAULT_MODEL = 'openai/gpt-5';
const CLAUDE_MODEL = 'claude-code/opus';

/**
 * The catalog both runtimes contribute to. `ORIGINAL_MODEL` is deliberately an
 * Anthropic model driven by the Pi runtime: `provider` (inference) and
 * `agentProvider` (runtime) are different axes, and only the second one pins a
 * chat.
 */
const CATALOG: AgentModelCatalog = {
	defaultModelId: ORIGINAL_MODEL,
	defaultThinkingLevel: 'medium',
	models: [
		{
			agentProvider: 'pi',
			displayName: 'Claude Sonnet',
			id: ORIGINAL_MODEL,
			provider: 'anthropic',
			thinkingLevels: ['medium'],
		},
		{
			agentProvider: 'pi',
			displayName: 'GPT-5',
			id: NEW_DEFAULT_MODEL,
			provider: 'openai',
			thinkingLevels: ['medium'],
		},
		{
			agentProvider: 'claude',
			displayName: 'Claude Opus',
			id: CLAUDE_MODEL,
			provider: 'claude-code',
			thinkingLevels: ['medium'],
		},
	],
};

/** Creates an existing agent session whose model must remain scoped to its chat. */
function createSession(
	provider: AgentProviderId = 'pi',
): AgentSessionSnapshotWire {
	return {
		branchId: 'branch-model-preservation',
		closedAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		cwd: '/tmp/workspace-model-preservation',
		id: SESSION_ID,
		label: null,
		model: ORIGINAL_MODEL,
		openedTabs: [],
		provider,
		runtimeOpen: true,
		runtimeSessionId: 'runtime-session-model-preservation',
		status: 'idle',
		thinkingLevel: 'medium',
		updatedAt: '2026-01-01T00:00:00.000Z',
		workspaceId: WORKSPACE_ID,
	};
}

/** Renders the composer with an optional persisted session and mutable app settings. */
function renderComposer(options?: {
	currentAgentSessionId?: string;
	withSession?: boolean;
	defaultModel?: string;
	sessionProvider?: AgentProviderId;
}) {
	const withSession = options?.withSession ?? true;
	const defaultModel = options?.defaultModel ?? ORIGINAL_MODEL;
	const client = createTestQueryClient();
	client.setQueryData(ensemblrQueryKeys.agentModels(), CATALOG);
	client.setQueryData(
		ensemblrQueryKeys.agentSessionsForWorkspace(WORKSPACE_ID),
		{
			sessions: withSession ? [createSession(options?.sessionProvider)] : [],
		},
	);
	client.setQueryData(
		ensemblrQueryKeys.agentSessionEvents('branch-model-preservation'),
		{
			events: [],
		},
	);

	const store = createStore();
	store.set(appSettingsAtom, {
		...DEFAULT_APP_SETTINGS,
		models: {
			...DEFAULT_APP_SETTINGS.models,
			defaultModel,
		},
	});
	const wrapper = ({ children }: PropsWithChildren) => (
		<Provider store={store}>
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		</Provider>
	);
	const hook = renderHook(
		() =>
			useAgentComposerController({
				chatTabId: CHAT_TAB_ID,
				currentAgentSessionId:
					options?.currentAgentSessionId ?? (withSession ? SESSION_ID : null),
				workspaceCwd: '/tmp/workspace-model-preservation',
				workspaceId: WORKSPACE_ID,
			}),
		{ wrapper },
	);
	return { ...hook, store };
}

/**
 * Stubs the bridge so a submit really opens a session, while `listAgentSessions`
 * keeps returning an empty list — reproducing the window between opening a
 * session and the workspace session query catching up.
 */
function installBridgeWithoutSessionEcho() {
	const openAgentSession = vi.fn(async () => ({
		session: { ...createSession('claude'), id: PENDING_SESSION_ID },
	}));
	installEnsemblrApi({
		listAgentModels: vi.fn(async () => CATALOG),
		listAgentSessions: vi.fn(async () => ({ sessions: [] })),
		onAgentSessionEvent: vi.fn(() => () => undefined),
		openAgentSession,
		submitAgentPrompt: vi.fn(async () => ({
			acceptedAt: '2026-01-01T00:00:01.000Z',
			turnId: 'turn-1',
		})),
	});
	return { openAgentSession };
}

afterEach(() => {
	clearEnsemblrApi();
});

describe('agent composer model preservation', () => {
	test('keeps an active chat model when the default model changes', () => {
		const { result, store } = renderComposer();
		expect(result.current.modelId).toBe(ORIGINAL_MODEL);

		act(() => {
			store.set(appSettingsAtom, {
				...store.get(appSettingsAtom),
				models: {
					...store.get(appSettingsAtom).models,
					defaultModel: NEW_DEFAULT_MODEL,
				},
			});
		});

		expect(result.current.modelId).toBe(ORIGINAL_MODEL);
	});

	test('a fresh chat with no session inherits the Settings default model', () => {
		const { result } = renderComposer({
			defaultModel: NEW_DEFAULT_MODEL,
			withSession: false,
		});

		expect(result.current.modelId).toBe(NEW_DEFAULT_MODEL);
	});
});

describe('agent composer provider pin', () => {
	test('a chat with no session pins nothing, so any runtime is still selectable', () => {
		const { result } = renderComposer({ withSession: false });

		expect(result.current.activeSessionId).toBeNull();
		expect(result.current.lockedProvider).toBeNull();
	});

	test('a session recorded as Pi pins the chat to Pi', () => {
		const { result } = renderComposer({ sessionProvider: 'pi' });

		expect(result.current.lockedProvider).toBe('pi');
	});

	test('a session recorded as Claude pins the chat to Claude', () => {
		const { result } = renderComposer({ sessionProvider: 'claude' });

		expect(result.current.lockedProvider).toBe('claude');
	});

	test('the session runtime wins over the selected model’s runtime', () => {
		const { result } = renderComposer({ sessionProvider: 'claude' });

		expect(result.current.modelId).toBe(ORIGINAL_MODEL);
		expect(
			result.current.availableModels.find(
				(model) => model.id === ORIGINAL_MODEL,
			)?.agentProvider,
		).toBe('pi');
		expect(result.current.lockedProvider).toBe('claude');
	});

	test('a stale session id that matches no snapshot pins nothing', () => {
		const { result } = renderComposer({
			currentAgentSessionId: 'session-deleted-elsewhere',
			withSession: false,
		});

		expect(result.current.activeSessionId).toBeNull();
		expect(result.current.lockedProvider).toBeNull();
	});

	test('a session that has not reached the cache yet pins to the selected model’s runtime', async () => {
		const { openAgentSession } = installBridgeWithoutSessionEcho();
		const { result } = renderComposer({
			defaultModel: CLAUDE_MODEL,
			withSession: false,
		});
		expect(result.current.modelId).toBe(CLAUDE_MODEL);
		expect(result.current.lockedProvider).toBeNull();

		await act(async () => {
			await result.current.onSubmit('start the chat');
		});

		expect(openAgentSession).toHaveBeenCalledTimes(1);
		expect(result.current.activeSessionId).toBe(PENDING_SESSION_ID);
		expect(result.current.lockedProvider).toBe('claude');
	});
});
