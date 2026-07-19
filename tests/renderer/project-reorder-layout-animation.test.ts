import { createStore } from 'jotai';
import { afterEach, expect, test, vi } from 'vitest';

import {
	disableProjectReorderLayoutAnimationAtom,
	isProjectReorderLayoutAnimationDisabledAtom,
} from '../../src/renderer/state/workspace/structure-atoms';

afterEach(() => {
	vi.useRealTimers();
});

test('extends layout-animation suppression across overlapping sidebar reflows', () => {
	vi.useFakeTimers();
	const store = createStore();

	store.set(disableProjectReorderLayoutAnimationAtom);
	expect(store.get(isProjectReorderLayoutAnimationDisabledAtom)).toBe(true);

	vi.advanceTimersByTime(100);
	store.set(disableProjectReorderLayoutAnimationAtom);
	vi.advanceTimersByTime(80);
	expect(store.get(isProjectReorderLayoutAnimationDisabledAtom)).toBe(true);

	vi.advanceTimersByTime(100);
	expect(store.get(isProjectReorderLayoutAnimationDisabledAtom)).toBe(false);
});
