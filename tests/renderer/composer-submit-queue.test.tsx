// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { PropsWithChildren } from 'react';
import { describe, expect, test, vi } from 'vitest';

import {
	useComposerSubmit,
	useComposerSubmitConsumer,
	useDropComposerSubmits,
} from '../../src/renderer/state/composer';
import { activeChatTabByWorkspaceAtom } from '../../src/renderer/state/workspace/selection-atoms';
import type { QueuedFollowUpSource } from '../../src/renderer/types/workbench';

const WORKSPACE_ID = 'workspace-submit-queue';
const BUSY_TAB_ID = 'chat-tab-busy';
const IDLE_TAB_ID = 'chat-tab-idle';

type ChannelSubmit = (text: string, source: QueuedFollowUpSource) => boolean;

/** Renders the enqueue side and one consumer, both over the same Jotai store. */
function renderQueue(activeChatTabId: string) {
	const store = createStore();
	store.set(activeChatTabByWorkspaceAtom, {
		[WORKSPACE_ID]: activeChatTabId,
	});
	const wrapper = ({ children }: PropsWithChildren) => (
		<Provider store={store}>{children}</Provider>
	);

	const enqueue = renderHook(() => useComposerSubmit(WORKSPACE_ID), {
		wrapper,
	});
	const consumer = (chatTabId: string, submit: ChannelSubmit) =>
		renderHook(
			({ submit: current }: { submit: ChannelSubmit }) =>
				useComposerSubmitConsumer(chatTabId, current),
			{ initialProps: { submit }, wrapper },
		);
	const drop = renderHook(() => useDropComposerSubmits(), { wrapper });
	return { consumer, drop, enqueue, store };
}

describe('composer auto-submit queue', () => {
	test('a chore queued for a busy tab is not delivered to another tab', () => {
		const { consumer, enqueue } = renderQueue(BUSY_TAB_ID);
		const busySubmit = vi.fn(() => false);
		const idleSubmit = vi.fn(() => true);

		consumer(BUSY_TAB_ID, busySubmit);
		act(() => {
			enqueue.result.current('commit and push');
		});
		expect(busySubmit).toHaveBeenCalledWith('commit and push', 'chore');

		consumer(IDLE_TAB_ID, idleSubmit);

		expect(idleSubmit).not.toHaveBeenCalled();
	});

	test('the tab a chore was queued for still drains it once it is free', () => {
		const { consumer, enqueue } = renderQueue(BUSY_TAB_ID);
		const blocked = vi.fn(() => false);
		const free = vi.fn(() => true);

		const mounted = consumer(BUSY_TAB_ID, blocked);
		act(() => {
			enqueue.result.current('commit and push');
		});
		expect(blocked).toHaveBeenCalledTimes(1);

		act(() => {
			mounted.rerender({ submit: free });
		});

		expect(free).toHaveBeenCalledWith('commit and push', 'chore');
	});

	test('a workspace with no recorded active chat tab queues nothing and reports it', () => {
		const { consumer, enqueue, store } = renderQueue(BUSY_TAB_ID);
		store.set(activeChatTabByWorkspaceAtom, {});
		const submit = vi.fn(() => true);
		let queued: boolean | undefined;

		consumer(BUSY_TAB_ID, submit);
		act(() => {
			queued = enqueue.result.current('commit and push');
		});

		expect(queued).toBe(false);
		expect(submit).not.toHaveBeenCalled();
	});

	test('a successfully queued chore reports that it was accepted', () => {
		const { enqueue } = renderQueue(BUSY_TAB_ID);
		let queued: boolean | undefined;

		act(() => {
			queued = enqueue.result.current('commit and push');
		});

		expect(queued).toBe(true);
	});

	// A turn re-sent from its error row is the user asking again, not a background
	// chore, so the Follow-up behavior has to treat it the way it treats a typed
	// message rather than always draining it.
	test('carries the source a caller queued with through to the composer', () => {
		const { consumer, enqueue } = renderQueue(BUSY_TAB_ID);
		const submit = vi.fn(() => true);

		consumer(BUSY_TAB_ID, submit);
		act(() => {
			enqueue.result.current('Continue', 'user');
		});

		expect(submit).toHaveBeenCalledWith('Continue', 'user');
	});

	test('dropping a closing tab discards the chore it was still holding', () => {
		const { consumer, drop, enqueue } = renderQueue(BUSY_TAB_ID);
		const blocked = vi.fn(() => false);
		const free = vi.fn(() => true);

		const mounted = consumer(BUSY_TAB_ID, blocked);
		act(() => {
			enqueue.result.current('commit and push');
		});
		expect(blocked).toHaveBeenCalledTimes(1);

		let dropped: number | undefined;
		act(() => {
			dropped = drop.result.current(BUSY_TAB_ID);
		});
		expect(dropped).toBe(1);

		// The tab reopening (or its composer freeing up) must not resurrect a chore
		// the close already cancelled and reported.
		act(() => {
			mounted.rerender({ submit: free });
		});
		expect(free).not.toHaveBeenCalled();
	});

	test('dropping a tab that holds nothing leaves other tabs’ chores alone', () => {
		const { consumer, drop, enqueue } = renderQueue(BUSY_TAB_ID);
		const blocked = vi.fn(() => false);
		const free = vi.fn(() => true);

		const mounted = consumer(BUSY_TAB_ID, blocked);
		act(() => {
			enqueue.result.current('commit and push');
		});

		let dropped: number | undefined;
		act(() => {
			dropped = drop.result.current(IDLE_TAB_ID);
		});
		expect(dropped).toBe(0);

		act(() => {
			mounted.rerender({ submit: free });
		});
		expect(free).toHaveBeenCalledWith('commit and push', 'chore');
	});
});
