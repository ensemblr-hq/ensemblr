// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { Provider } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import {
	useDismissPlanReview,
	usePendingPlanReview,
	usePlanReviewSync,
} from '@/renderer/state/plan-mode';
import type { ExitPlanModeBroadcast } from '@/shared/agent-control';
import { clearEnsemblrApi, installEnsemblrApi } from '../support/dom';

const broadcast = (
	requestId: string,
	agentSessionId: string,
): ExitPlanModeBroadcast => ({
	agentSessionId,
	planPath: '.context/plans/20260728-1432-add-plan-mode.md',
	requestId,
	title: 'Add Plan Mode',
	workspaceId: 'ws-1',
});

/** Captures the broadcast listener so tests can drive main→renderer pushes. */
const installBridge = () => {
	const listeners: { review?: (payload: ExitPlanModeBroadcast) => void } = {};
	const unsubscribe = vi.fn();
	installEnsemblrApi({
		onExitPlanMode: (listener: (p: ExitPlanModeBroadcast) => void) => {
			listeners.review = listener;
			return unsubscribe;
		},
	});
	return { listeners, unsubscribe };
};

/** One Jotai store shared by every hook in a test, as the app root provides. */
const wrapper = ({ children }: { children: ReactNode }) => (
	<Provider>{children}</Provider>
);

const mountPending = (agentSessionId: string) =>
	renderHook(
		() => {
			usePlanReviewSync();
			return {
				dismiss: useDismissPlanReview(),
				pending: usePendingPlanReview(agentSessionId),
			};
		},
		{ wrapper },
	);

afterEach(() => {
	clearEnsemblrApi();
});

test('surfaces a broadcast plan in the chat that wrote it', () => {
	const { listeners } = installBridge();
	const { result } = mountPending('session-1');

	act(() => listeners.review?.(broadcast('req-1', 'session-1')));

	expect(result.current.pending?.requestId).toBe('req-1');
	expect(result.current.pending?.title).toBe('Add Plan Mode');
});

test('keeps one chat’s plan out of another chat', () => {
	const { listeners } = installBridge();
	const { result } = renderHook(
		() => {
			usePlanReviewSync();
			return {
				one: usePendingPlanReview('session-1'),
				two: usePendingPlanReview('session-2'),
			};
		},
		{ wrapper },
	);

	act(() => listeners.review?.(broadcast('req-1', 'session-1')));

	expect(result.current.one?.requestId).toBe('req-1');
	expect(result.current.two).toBeNull();
});

test('clears the panel once the user decides', () => {
	const { listeners } = installBridge();
	const { result } = mountPending('session-1');
	act(() => listeners.review?.(broadcast('req-1', 'session-1')));

	act(() => result.current.dismiss('session-1'));

	expect(result.current.pending).toBeNull();
});

test('ignores a dismissal for a chat with no plan waiting', () => {
	installBridge();
	const { result } = mountPending('session-1');

	act(() => result.current.dismiss('session-2'));

	expect(result.current.pending).toBeNull();
});

test('replaces an earlier plan when the agent submits a revision', () => {
	const { listeners } = installBridge();
	const { result } = mountPending('session-1');
	act(() => listeners.review?.(broadcast('req-1', 'session-1')));

	act(() => listeners.review?.(broadcast('req-2', 'session-1')));

	expect(result.current.pending?.requestId).toBe('req-2');
});

test('unsubscribes on unmount', () => {
	const { unsubscribe } = installBridge();
	const { unmount } = mountPending('session-1');

	unmount();

	expect(unsubscribe).toHaveBeenCalledTimes(1);
});
