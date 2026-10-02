// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';
import type { ExitPlanModeBroadcast } from '../../src/shared/agent-control';
import { clearEnsemblrApi, installEnsemblrApi } from './support/dom';

const {
	dismissPlanReview,
	handOff,
	pendingReview,
	requestComposerFocus,
	setAgentPlanMode,
} = vi.hoisted(() => ({
	dismissPlanReview: vi.fn(),
	handOff: vi.fn(),
	pendingReview: { current: null as ExitPlanModeBroadcast | null },
	requestComposerFocus: vi.fn(),
	setAgentPlanMode: vi.fn(),
}));

vi.mock('@/renderer/state/plan-mode', () => ({
	useDismissPlanReview: () => dismissPlanReview,
	usePendingPlanReview: () => pendingReview.current,
}));

vi.mock('@/renderer/state/composer', () => ({
	useRequestComposerFocus: () => requestComposerFocus,
}));

vi.mock(
	'@/renderer/hooks/workbench-shell/conversation-panel/use-plan-handoff',
	() => ({ usePlanHandoff: () => ({ handOff, isHandingOff: false }) }),
);

import { usePlanReview } from '../../src/renderer/hooks/workbench-shell/conversation-panel/use-plan-review';

const CHAT_TAB_ID = 'tab-1';
const SESSION_ID = 'sess-1';
const PLAN_PATH = '.context/plans/20260728-1432-add-plan-mode.md';

const workspace = { id: 'ws-1', projectId: 'repo-1' } as WorkspaceShellModel;

const wrapper = ({ children }: { children: ReactNode }) => (
	<Provider>{children}</Provider>
);

const renderReview = () => {
	const onPlanModeChange = vi.fn();
	const onSubmit = vi.fn().mockResolvedValue(undefined);
	const { result } = renderHook(
		() =>
			usePlanReview({
				agentSessionId: SESSION_ID,
				chatTabId: CHAT_TAB_ID,
				onPlanModeChange,
				onSubmit,
				workspace,
			}),
		{ wrapper },
	);
	return { onPlanModeChange, onSubmit, result };
};

beforeEach(() => {
	vi.clearAllMocks();
	installEnsemblrApi({ setAgentPlanMode });
	setAgentPlanMode.mockResolvedValue(undefined);
	handOff.mockResolvedValue('tab-new');
	pendingReview.current = {
		agentSessionId: SESSION_ID,
		planPath: PLAN_PATH,
		requestId: 'req-1',
		title: 'Add Plan Mode',
		workspaceId: 'ws-1',
	};
});

afterEach(() => {
	clearEnsemblrApi();
});

describe('usePlanReview', () => {
	it('surfaces the pending plan', () => {
		const { result } = renderReview();

		expect(result.current.review?.title).toBe('Add Plan Mode');
	});

	describe('approve', () => {
		it('turns plan mode off, clears the panel, and starts the build turn', () => {
			const { onPlanModeChange, onSubmit, result } = renderReview();

			act(() => result.current.approve());

			expect(onPlanModeChange).toHaveBeenCalledWith(false);
			expect(dismissPlanReview).toHaveBeenCalledWith(SESSION_ID);
			expect(onSubmit).toHaveBeenCalledWith('Approved — implement the plan.');
		});
	});

	describe('refine', () => {
		it('clears the panel and hands the user back their composer', () => {
			const { onSubmit, result } = renderReview();

			act(() => result.current.refine());

			expect(dismissPlanReview).toHaveBeenCalledWith(SESSION_ID);
			expect(requestComposerFocus).toHaveBeenCalledWith(CHAT_TAB_ID);
			expect(onSubmit).not.toHaveBeenCalled();
		});

		// Refining means keeping on planning, so the toggle must stay on.
		it('leaves plan mode on', () => {
			const { onPlanModeChange, result } = renderReview();

			act(() => result.current.refine());

			expect(onPlanModeChange).not.toHaveBeenCalled();
		});
	});

	describe('hand off', () => {
		it('moves the plan to a new chat, then clears the panel', async () => {
			const { onPlanModeChange, onSubmit, result } = renderReview();

			await act(async () => {
				result.current.handOff();
			});

			expect(handOff).toHaveBeenCalledWith({
				planPath: PLAN_PATH,
				title: 'Add Plan Mode',
			});
			expect(onPlanModeChange).toHaveBeenCalledWith(false);
			expect(dismissPlanReview).toHaveBeenCalledWith(SESSION_ID);
			expect(onSubmit).not.toHaveBeenCalled();
		});

		it('keeps the panel up when the handoff tab could not be created', async () => {
			handOff.mockResolvedValue(null);
			const { onPlanModeChange, result } = renderReview();

			await act(async () => {
				result.current.handOff();
			});

			expect(dismissPlanReview).not.toHaveBeenCalled();
			expect(onPlanModeChange).not.toHaveBeenCalled();
			expect(setAgentPlanMode).not.toHaveBeenCalled();
		});

		// Nothing is submitted to this session again, so the toggle has no prompt to
		// ride over. Main would keep the session planning with a plan still awaiting
		// a decision, and answer the next control follow-up with "resubmit it".
		it('tells main planning is over, since no prompt will carry the toggle', async () => {
			const { result } = renderReview();

			await act(async () => {
				result.current.handOff();
			});

			expect(setAgentPlanMode).toHaveBeenCalledWith({
				planMode: false,
				sessionId: SESSION_ID,
			});
		});
	});

	it('does nothing when no plan is waiting', () => {
		pendingReview.current = null;
		const { onPlanModeChange, onSubmit, result } = renderReview();

		act(() => {
			result.current.approve();
			result.current.refine();
			result.current.handOff();
		});

		expect(onPlanModeChange).not.toHaveBeenCalled();
		expect(onSubmit).not.toHaveBeenCalled();
		expect(handOff).not.toHaveBeenCalled();
		expect(dismissPlanReview).not.toHaveBeenCalled();
	});
});
