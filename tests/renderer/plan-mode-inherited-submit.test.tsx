// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openPiSession, submitPiPrompt } = vi.hoisted(() => ({
	openPiSession: vi.fn(),
	submitPiPrompt: vi.fn(),
}));

vi.mock('@/renderer/api/ensemblr-queries', async (importOriginal) => ({
	...(await importOriginal<
		typeof import('../../src/renderer/api/ensemblr-queries')
	>()),
	openPiSession,
	submitPiPrompt,
}));

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import { usePiComposerController } from '../../src/renderer/state/composer';
import { usePlanModeSync } from '../../src/renderer/state/plan-mode';
import { appSettingsAtom } from '../../src/renderer/state/preferences';
import type { PlanModeChangedBroadcast } from '../../src/shared/agent-control';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config';
import type { PiSessionSnapshotWire } from '../../src/shared/ipc/contracts/pi-session';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
} from './support/dom';

const CHILD_TAB_ID = 'chat-spawned-child';
const OTHER_TAB_ID = 'chat-unrelated';
const WORKSPACE_ID = 'workspace-inherited';
const SESSION_ID = 'session-spawned-child';
const MODEL = 'anthropic/claude-sonnet';

/** An open, idle session, so submitting never has to open one first. */
function createSession(): PiSessionSnapshotWire {
	return {
		branchId: 'branch-inherited',
		closedAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		cwd: '/tmp/workspace-inherited',
		id: SESSION_ID,
		label: null,
		model: MODEL,
		openedTabs: [],
		piSessionId: SESSION_ID,
		runtimeOpen: true,
		status: 'idle',
		thinkingLevel: 'medium',
		updatedAt: '2026-01-01T00:00:00.000Z',
		workspaceId: WORKSPACE_ID,
	};
}

/**
 * Mounts the spawned child's composer and the plan-mode sync effect in ONE Jotai
 * store, as the app root does. Two stores would let the broadcast write land
 * somewhere the composer never reads, and every assertion here would pass
 * vacuously.
 */
function renderSpawnedChild() {
	const listeners: {
		planMode?: (payload: PlanModeChangedBroadcast) => void;
	} = {};
	installEnsemblrApi({
		onPiSessionEvent: () => () => undefined,
		onPlanModeChanged: (listener: (p: PlanModeChangedBroadcast) => void) => {
			listeners.planMode = listener;
			return vi.fn();
		},
	});

	const client = createTestQueryClient();
	client.setQueryData(ensemblrQueryKeys.piModels(), {
		defaultModelId: MODEL,
		defaultThinkingLevel: 'medium',
		models: [
			{
				displayName: 'Claude Sonnet',
				id: MODEL,
				provider: 'anthropic',
				thinkingLevels: ['medium'],
			},
		],
	});
	client.setQueryData(ensemblrQueryKeys.piSessionsForWorkspace(WORKSPACE_ID), {
		sessions: [createSession()],
	});
	client.setQueryData(ensemblrQueryKeys.piSessionEvents('branch-inherited'), {
		events: [],
	});

	const store = createStore();
	store.set(appSettingsAtom, DEFAULT_APP_SETTINGS);

	const wrapper = ({ children }: PropsWithChildren) => (
		<Provider store={store}>
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		</Provider>
	);

	const rendered = renderHook(
		() => {
			usePlanModeSync();
			return usePiComposerController({
				chatTabId: CHILD_TAB_ID,
				currentPiSessionId: SESSION_ID,
				workspaceCwd: '/tmp/workspace-inherited',
				workspaceId: WORKSPACE_ID,
			});
		},
		{ wrapper },
	);
	return { listeners, result: rendered.result };
}

const inherit = (chatTabId: string): PlanModeChangedBroadcast => ({
	chatTabId,
	piSessionId: SESSION_ID,
	planMode: true,
	workspaceId: WORKSPACE_ID,
});

beforeEach(() => {
	vi.clearAllMocks();
	clearEnsemblrApi();
	globalThis.localStorage?.clear();
	openPiSession.mockResolvedValue({ session: createSession() });
	submitPiPrompt.mockResolvedValue({});
});

describe('a spawned child that inherited Plan Mode', () => {
	it('shows the composer toggle on once main says so', async () => {
		const { listeners, result } = renderSpawnedChild();

		await act(async () => {
			listeners.planMode?.(inherit(CHILD_TAB_ID));
		});

		expect(result.current.planMode).toBe(true);
	});

	// The regression the whole change exists for: before this, the child's tab had no
	// opinion, so the user's first follow-up sent `planMode: false` and silently
	// unblocked a conversation main was gating.
	it('keeps Plan Mode on when the user follows up in its tab', async () => {
		const { listeners, result } = renderSpawnedChild();
		await act(async () => {
			listeners.planMode?.(inherit(CHILD_TAB_ID));
		});

		await act(async () => {
			await result.current.onSubmit('How does the registry key sessions?');
		});

		expect(submitPiPrompt).toHaveBeenCalledWith(
			expect.objectContaining({ planMode: true }),
		);
	});

	// Snapshot inheritance: the child owns the flag once it has it, so the user can
	// still turn Plan Mode off in that tab.
	it('lets the user turn it off again', async () => {
		const { listeners, result } = renderSpawnedChild();
		await act(async () => {
			listeners.planMode?.(inherit(CHILD_TAB_ID));
		});

		await act(async () => {
			result.current.onPlanModeChange(false);
		});
		await act(async () => {
			await result.current.onSubmit('Actually, go ahead and fix it.');
		});

		expect(submitPiPrompt).toHaveBeenCalledWith(
			expect.objectContaining({ planMode: false }),
		);
	});

	it('ignores a broadcast aimed at another tab', async () => {
		const { listeners, result } = renderSpawnedChild();

		await act(async () => {
			listeners.planMode?.(inherit(OTHER_TAB_ID));
		});

		expect(result.current.planMode).toBe(false);
	});
});

describe('a chat the user has never decided for', () => {
	// Sending `false` for "no opinion" is what let a follow-up clear an inherited
	// flag. Omitting the field entirely leaves main holding whatever it already has.
	it('submits without a planMode field at all', async () => {
		const { result } = renderSpawnedChild();

		await act(async () => {
			await result.current.onSubmit('Just a question.');
		});

		expect(submitPiPrompt).toHaveBeenCalledTimes(1);
		expect(submitPiPrompt.mock.calls[0][0]).not.toHaveProperty('planMode');
	});

	it('opens a session without a planMode field at all', async () => {
		const { result } = renderSpawnedChild();

		await act(async () => {
			await result.current.onSubmit('First message.');
		});

		for (const call of openPiSession.mock.calls) {
			expect(call[0]).not.toHaveProperty('planMode');
		}
	});

	it('sends an explicit false once the user turns it off by hand', async () => {
		const { result } = renderSpawnedChild();

		await act(async () => {
			result.current.onPlanModeChange(false);
		});
		await act(async () => {
			await result.current.onSubmit('Go.');
		});

		expect(submitPiPrompt).toHaveBeenCalledWith(
			expect.objectContaining({ planMode: false }),
		);
	});
});
