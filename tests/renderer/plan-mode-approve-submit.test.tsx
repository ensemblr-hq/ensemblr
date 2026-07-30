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

vi.mock(
	'@/renderer/hooks/workbench-shell/conversation-panel/use-plan-handoff',
	() => ({
		usePlanHandoff: () => ({ handOff: vi.fn(), isHandingOff: false }),
	}),
);

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';
import { usePlanReview } from '../../src/renderer/hooks/workbench-shell/conversation-panel/use-plan-review';
import { usePiComposerController } from '../../src/renderer/state/composer';
import { pendingPlanReviewsAtom } from '../../src/renderer/state/plan-mode/atoms';
import {
	appSettingsAtom,
	chatPlanModeAtomFamily,
} from '../../src/renderer/state/preferences';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config';
import type { PiSessionSnapshotWire } from '../../src/shared/ipc/contracts/pi-session';
import { createTestQueryClient, installLocalStorage } from './support/dom';

const CHAT_TAB_ID = 'chat-plan-approve';
const WORKSPACE_ID = 'workspace-plan-approve';
const SESSION_ID = 'session-plan-approve';
const MODEL = 'anthropic/claude-sonnet';

const workspace = {
	id: WORKSPACE_ID,
	projectId: 'repo-plan-approve',
} as WorkspaceShellModel;

/** An open, idle session, so submitting never has to open one first. */
function createSession(): PiSessionSnapshotWire {
	return {
		branchId: 'branch-plan-approve',
		closedAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		cwd: '/tmp/workspace-plan-approve',
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
 * Renders the composer controller and the plan review that drives it.
 * @param seedPlanMode - Pre-set the chat's Plan Mode as main's spawn broadcast
 *   would, i.e. without the user ever touching the toggle.
 */
function renderPlanningChat(seedPlanMode?: boolean) {
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
	client.setQueryData(
		ensemblrQueryKeys.piSessionEvents('branch-plan-approve'),
		{
			events: [],
		},
	);

	const store = createStore();
	store.set(appSettingsAtom, DEFAULT_APP_SETTINGS);
	if (seedPlanMode !== undefined) {
		store.set(chatPlanModeAtomFamily(CHAT_TAB_ID), seedPlanMode);
	}
	store.set(pendingPlanReviewsAtom, {
		[SESSION_ID]: {
			piSessionId: SESSION_ID,
			planPath: '.context/plans/20260728-1432-add-plan-mode.md',
			requestId: 'req-1',
			title: 'Add Plan Mode',
			workspaceId: WORKSPACE_ID,
		},
	});

	const wrapper = ({ children }: PropsWithChildren) => (
		<Provider store={store}>
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		</Provider>
	);

	return renderHook(
		() => {
			const composer = usePiComposerController({
				chatTabId: CHAT_TAB_ID,
				currentPiSessionId: SESSION_ID,
				workspaceCwd: '/tmp/workspace-plan-approve',
				workspaceId: WORKSPACE_ID,
			});
			const plan = usePlanReview({
				chatTabId: CHAT_TAB_ID,
				onPlanModeChange: composer.onPlanModeChange,
				onSubmit: composer.onSubmit,
				piSessionId: SESSION_ID,
				workspace,
			});
			return { composer, plan };
		},
		{ wrapper },
	);
}

// `atomWithStorage` re-reads storage when the atom mounts, so a value seeded
// before render survives only if storage exists. happy-dom ships none here.
beforeEach(() => {
	vi.clearAllMocks();
	installLocalStorage();
	openPiSession.mockResolvedValue({ session: createSession() });
	submitPiPrompt.mockResolvedValue({});
});

describe('approving a plan', () => {
	// The regression this guards: approve turns the toggle off and submits in the
	// same tick. A mutation's options are only refreshed on commit, so reading
	// `planMode` from render scope sent `true` on the very turn meant to build.
	it('submits the build turn with plan mode already off', async () => {
		const { result } = renderPlanningChat();

		await act(async () => {
			result.current.composer.onPlanModeChange(true);
		});
		expect(result.current.composer.planMode).toBe(true);

		await act(async () => {
			result.current.plan.approve();
		});

		expect(submitPiPrompt).toHaveBeenCalledTimes(1);
		expect(submitPiPrompt).toHaveBeenCalledWith(
			expect.objectContaining({
				planMode: false,
				prompt: 'Approved — implement the plan.',
				sessionId: SESSION_ID,
			}),
		);
	});

	// Plan Mode that arrived from main rather than from the toggle must clear the
	// same way, or a spawned chat handed a plan could never start implementing.
	it('submits with plan mode off even when main set it, not the user', async () => {
		const { result } = renderPlanningChat(true);
		expect(result.current.composer.planMode).toBe(true);

		await act(async () => {
			result.current.plan.approve();
		});

		expect(submitPiPrompt).toHaveBeenCalledWith(
			expect.objectContaining({ planMode: false }),
		);
	});

	it('keeps plan mode on when the user refines instead', async () => {
		const { result } = renderPlanningChat();

		await act(async () => {
			result.current.composer.onPlanModeChange(true);
		});
		await act(async () => {
			result.current.plan.refine();
		});
		await act(async () => {
			await result.current.composer.onSubmit('Tighten step 3.');
		});

		expect(submitPiPrompt).toHaveBeenCalledWith(
			expect.objectContaining({ planMode: true }),
		);
	});
});
