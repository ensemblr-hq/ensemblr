// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { usePlanModeSync } from '@/renderer/state/plan-mode';
import { chatPlanModeAtomFamily } from '@/renderer/state/preferences';
import type { PlanModeChangedBroadcast } from '@/shared/agent-control';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	installLocalStorage,
} from '../support/dom';

const broadcast = (
	chatTabId: string,
	planMode: boolean,
): PlanModeChangedBroadcast => ({
	agentSessionId: 'agent-child',
	chatTabId,
	planMode,
	workspaceId: 'ws-1',
});

/** Captures the broadcast listener so tests can drive main→renderer pushes. */
const installBridge = () => {
	const listeners: {
		planMode?: (payload: PlanModeChangedBroadcast) => void;
	} = {};
	const unsubscribe = vi.fn();
	installEnsemblrApi({
		onPlanModeChanged: (listener: (p: PlanModeChangedBroadcast) => void) => {
			listeners.planMode = listener;
			return unsubscribe;
		},
	});
	return { listeners, unsubscribe };
};

/** One Jotai store shared by every hook in a test, as the app root provides. */
const wrapper = ({ children }: { children: ReactNode }) => (
	<Provider>{children}</Provider>
);

beforeEach(() => {
	installLocalStorage();
});

afterEach(() => {
	clearEnsemblrApi();
});

test('turns on the toggle for the tab main put into Plan Mode', () => {
	const { listeners } = installBridge();
	const { result } = renderHook(
		() => {
			usePlanModeSync();
			return useAtomValue(chatPlanModeAtomFamily('tab-a'));
		},
		{ wrapper },
	);

	act(() => listeners.planMode?.(broadcast('tab-a', true)));

	expect(result.current).toBe(true);
});

test('leaves every other chat tab alone', () => {
	const { listeners } = installBridge();
	const { result } = renderHook(
		() => {
			usePlanModeSync();
			return {
				a: useAtomValue(chatPlanModeAtomFamily('tab-a')),
				b: useAtomValue(chatPlanModeAtomFamily('tab-b')),
			};
		},
		{ wrapper },
	);

	act(() => listeners.planMode?.(broadcast('tab-a', true)));

	expect(result.current.a).toBe(true);
	expect(result.current.b).toBeNull();
});

// The channel is a state push, not a spawn-only event, so a future main-side clear
// needs no second channel.
test('turns the toggle back off when main says so', () => {
	const { listeners } = installBridge();
	const { result } = renderHook(
		() => {
			usePlanModeSync();
			return useAtomValue(chatPlanModeAtomFamily('tab-a'));
		},
		{ wrapper },
	);
	act(() => listeners.planMode?.(broadcast('tab-a', true)));

	act(() => listeners.planMode?.(broadcast('tab-a', false)));

	expect(result.current).toBe(false);
});

// A spawn lands in a tab the user is not looking at, so the write has to survive
// the target chat's composer never having been mounted.
test('a write to an unmounted tab is visible when that tab later mounts', () => {
	const { listeners } = installBridge();
	const store = renderHook(() => usePlanModeSync(), { wrapper });

	act(() => listeners.planMode?.(broadcast('tab-later', true)));
	store.unmount();

	const { result } = renderHook(
		() => useAtomValue(chatPlanModeAtomFamily('tab-later')),
		{ wrapper },
	);
	expect(result.current).toBe(true);
});

test('unsubscribes on unmount', () => {
	const { unsubscribe } = installBridge();
	const { unmount } = renderHook(() => usePlanModeSync(), { wrapper });

	unmount();

	expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('does not throw when no bridge is installed', () => {
	clearEnsemblrApi();

	expect(() => renderHook(() => usePlanModeSync(), { wrapper })).not.toThrow();
});
