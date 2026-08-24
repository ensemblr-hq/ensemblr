import { createStore } from 'jotai';
import { describe, expect, test } from 'vitest';

import {
	conciergeComposerFocusRequestAtom,
	conciergePresentationAtom,
	focusConciergeComposerAtom,
	toggleConciergeAtom,
	toggleConciergeFullscreenAtom,
} from '@/renderer/state/concierge';

describe('the Concierge presentation actions', () => {
	test('toggles between closed and the docked panel', () => {
		const store = createStore();

		store.set(toggleConciergeAtom);
		expect(store.get(conciergePresentationAtom)).toBe('panel');

		store.set(toggleConciergeAtom);
		expect(store.get(conciergePresentationAtom)).toBe('closed');
	});

	test('closes from maximized in one press, not two', () => {
		const store = createStore();
		store.set(conciergePresentationAtom, 'fullscreen');

		store.set(toggleConciergeAtom);

		expect(store.get(conciergePresentationAtom)).toBe('closed');
	});

	test('maximizes straight from closed and restores to the panel', () => {
		const store = createStore();

		store.set(toggleConciergeFullscreenAtom);
		expect(store.get(conciergePresentationAtom)).toBe('fullscreen');

		store.set(toggleConciergeFullscreenAtom);
		expect(store.get(conciergePresentationAtom)).toBe('panel');
	});

	test('opens the panel before asking its composer for focus', () => {
		const store = createStore();

		store.set(focusConciergeComposerAtom);

		// The composer mounts with the panel, so a request raised against a closed
		// Concierge would have nobody to consume it.
		expect(store.get(conciergePresentationAtom)).toBe('panel');
		expect(store.get(conciergeComposerFocusRequestAtom)).toBe(1);
	});

	test('leaves a maximized Concierge maximized when focusing its composer', () => {
		const store = createStore();
		store.set(conciergePresentationAtom, 'fullscreen');

		store.set(focusConciergeComposerAtom);

		expect(store.get(conciergePresentationAtom)).toBe('fullscreen');
	});

	test('counts each focus request, so two in a row both fire', () => {
		const store = createStore();

		store.set(focusConciergeComposerAtom);
		store.set(focusConciergeComposerAtom);

		expect(store.get(conciergeComposerFocusRequestAtom)).toBe(2);
	});
});
