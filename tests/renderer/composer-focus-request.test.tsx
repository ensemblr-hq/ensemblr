// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';

import {
	useConsumeComposerFocusRequest,
	useRequestComposerFocus,
} from '../../src/renderer/state/composer';

/**
 * Wrap hooks in a shared Jotai store so a request set by one hook is visible to
 * the consuming hook.
 * @param store - The Jotai store shared across the rendered hooks
 * @returns A provider wrapper component
 */
function makeWrapper(store: ReturnType<typeof createStore>) {
	return ({ children }: { children: ReactNode }) => (
		<Provider store={store}>{children}</Provider>
	);
}

describe('composer focus request channel', () => {
	test('focuses only the composer whose chat tab was targeted', () => {
		const store = createStore();
		const wrapper = makeWrapper(store);

		const focusTarget = vi.fn();
		const focusOther = vi.fn();
		renderHook(() => useConsumeComposerFocusRequest('chat-a', focusTarget), {
			wrapper,
		});
		renderHook(() => useConsumeComposerFocusRequest('chat-b', focusOther), {
			wrapper,
		});
		const { result } = renderHook(() => useRequestComposerFocus(), { wrapper });

		act(() => result.current('chat-a'));

		expect(focusTarget).toHaveBeenCalledTimes(1);
		expect(focusOther).not.toHaveBeenCalled();
	});

	test('a second request for the same tab re-fires focus', () => {
		const store = createStore();
		const wrapper = makeWrapper(store);

		const focus = vi.fn();
		renderHook(() => useConsumeComposerFocusRequest('chat-a', focus), {
			wrapper,
		});
		const { result } = renderHook(() => useRequestComposerFocus(), { wrapper });

		act(() => result.current('chat-a'));
		act(() => result.current('chat-a'));

		expect(focus).toHaveBeenCalledTimes(2);
	});
});
