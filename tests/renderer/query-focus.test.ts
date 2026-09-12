// @vitest-environment happy-dom

/**
 * `QueryObserver` fires a `refetchInterval` tick only when
 * `refetchIntervalInBackground || focusManager.isFocused()`, and the default
 * `isFocused` reads `document.visibilityState`. An Electron window the user has
 * clicked away from is still `visible`, so without this wiring every poll —
 * including the per-workspace `git status` fan-out — ran against a window
 * nobody was looking at.
 */

import { focusManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncQueryFocusWithWindow } from '@/renderer/lib/workbench/query-focus';

let hasFocus = true;
let visibilityState: DocumentVisibilityState = 'visible';

beforeEach(() => {
	hasFocus = true;
	visibilityState = 'visible';
	vi.spyOn(document, 'hasFocus').mockImplementation(() => hasFocus);
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => visibilityState,
	});
	syncQueryFocusWithWindow();
});

afterEach(() => {
	vi.restoreAllMocks();
	// Replace the listener rather than clearing it: `setEventListener` tears the
	// previous one down, and a no-op setup leaves the manager back on its default.
	focusManager.setEventListener(() => undefined);
	focusManager.setFocused(undefined);
});

describe('syncQueryFocusWithWindow', () => {
	it('reports the window as focused on setup', () => {
		expect(focusManager.isFocused()).toBe(true);
	});

	it('reports not focused once the window blurs, even while still visible', () => {
		hasFocus = false;
		window.dispatchEvent(new Event('blur'));

		expect(visibilityState).toBe('visible');
		expect(focusManager.isFocused()).toBe(false);
	});

	it('reports focused again when the window comes back', () => {
		hasFocus = false;
		window.dispatchEvent(new Event('blur'));
		hasFocus = true;
		window.dispatchEvent(new Event('focus'));

		expect(focusManager.isFocused()).toBe(true);
	});

	it('reports not focused for a minimized window', () => {
		visibilityState = 'hidden';
		hasFocus = false;
		window.dispatchEvent(new Event('visibilitychange'));

		expect(focusManager.isFocused()).toBe(false);
	});

	it('notifies subscribers when focus changes', () => {
		const seen: boolean[] = [];
		const unsubscribe = focusManager.subscribe((focused) => {
			seen.push(focused);
		});

		hasFocus = false;
		window.dispatchEvent(new Event('blur'));
		hasFocus = true;
		window.dispatchEvent(new Event('focus'));

		expect(seen).toEqual([false, true]);
		unsubscribe();
	});
});
