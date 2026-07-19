// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { PropsWithChildren } from 'react';
import { describe, expect, test } from 'vitest';

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import { usePiComposerController } from '../../src/renderer/state/composer';
import { appSettingsAtom } from '../../src/renderer/state/preferences';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config/app-settings';
import type { PiSessionSnapshotWire } from '../../src/shared/ipc/contracts/pi-session';
import { createTestQueryClient } from './support/dom';

const CHAT_TAB_ID = 'chat-model-preservation';
const WORKSPACE_ID = 'workspace-model-preservation';
const SESSION_ID = 'session-model-preservation';
const ORIGINAL_MODEL = 'anthropic/claude-sonnet';
const NEW_DEFAULT_MODEL = 'openai/gpt-5';

/** Creates an existing Pi session whose model must remain scoped to its chat. */
function createSession(): PiSessionSnapshotWire {
	return {
		branchId: 'branch-model-preservation',
		closedAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		cwd: '/tmp/workspace-model-preservation',
		id: SESSION_ID,
		label: null,
		model: ORIGINAL_MODEL,
		openedTabs: [],
		piSessionId: 'pi-session-model-preservation',
		runtimeOpen: true,
		status: 'idle',
		thinkingLevel: 'medium',
		updatedAt: '2026-01-01T00:00:00.000Z',
		workspaceId: WORKSPACE_ID,
	};
}

/** Renders the composer with an optional persisted session and mutable app settings. */
function renderComposer(options?: {
	withSession?: boolean;
	defaultModel?: string;
}) {
	const withSession = options?.withSession ?? true;
	const defaultModel = options?.defaultModel ?? ORIGINAL_MODEL;
	const client = createTestQueryClient();
	client.setQueryData(ensemblrQueryKeys.piModels(), {
		defaultModelId: ORIGINAL_MODEL,
		defaultThinkingLevel: 'medium',
		models: [
			{
				displayName: 'Claude Sonnet',
				id: ORIGINAL_MODEL,
				provider: 'anthropic',
				thinkingLevels: ['medium'],
			},
			{
				displayName: 'GPT-5',
				id: NEW_DEFAULT_MODEL,
				provider: 'openai',
				thinkingLevels: ['medium'],
			},
		],
	});
	client.setQueryData(ensemblrQueryKeys.piSessionsForWorkspace(WORKSPACE_ID), {
		sessions: withSession ? [createSession()] : [],
	});
	client.setQueryData(
		ensemblrQueryKeys.piSessionEvents('branch-model-preservation'),
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
			usePiComposerController({
				chatTabId: CHAT_TAB_ID,
				currentPiSessionId: withSession ? SESSION_ID : null,
				workspaceCwd: '/tmp/workspace-model-preservation',
				workspaceId: WORKSPACE_ID,
			}),
		{ wrapper },
	);
	return { ...hook, store };
}

describe('Pi composer model preservation', () => {
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
