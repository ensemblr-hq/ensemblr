// @vitest-environment happy-dom

import { getDefaultStore } from 'jotai';
import { act } from 'react';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { WindowChromeSync } from '../../src/renderer/components/workbench-shell/window-controls/window-chrome-sync';
import { windowChromeAtom } from '../../src/renderer/state/window-chrome';
import type { WindowChromeSnapshot } from '../../src/shared/window-chrome';
import { resolveWindowChrome } from '../../src/shared/window-chrome';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

const INSET_START = '--ensemblr-window-chrome-inset-start';

const store = getDefaultStore();

let listeners: ((snapshot: WindowChromeSnapshot) => void)[] = [];
let unsubscribed = 0;

beforeEach(() => {
	listeners = [];
	unsubscribed = 0;
	document.documentElement.removeAttribute('style');
	document.documentElement.className = '';
	store.set(windowChromeAtom, resolveWindowChrome('darwin', 'system'));
	installEnsemblrApi({
		onWindowChromeChanged: (
			listener: (snapshot: WindowChromeSnapshot) => void,
		) => {
			listeners.push(listener);
			return () => {
				unsubscribed += 1;
			};
		},
	});
});

afterEach(() => {
	clearEnsemblrApi();
});

/**
 * Pushes a snapshot through every subscription the component registered.
 * @param snapshot - The chrome main would have broadcast.
 */
function broadcast(snapshot: WindowChromeSnapshot): void {
	act(() => {
		for (const listener of listeners) {
			listener(snapshot);
		}
	});
}

test('a full-screen broadcast frees the leading inset and updates the atom', () => {
	renderWithProviders(<WindowChromeSync />);

	broadcast(resolveWindowChrome('darwin', 'system', true));

	expect(document.documentElement.style.getPropertyValue(INSET_START)).toBe(
		'0rem',
	);
	expect(store.get(windowChromeAtom).insets.start).toBe(0);
	expect(store.get(windowChromeAtom).fullScreen).toBe(true);
});

test('leaving full screen restores the inset the traffic lights need', () => {
	renderWithProviders(<WindowChromeSync />);

	broadcast(resolveWindowChrome('darwin', 'system', true));
	broadcast(resolveWindowChrome('darwin', 'system', false));

	expect(store.get(windowChromeAtom).insets.start).toBeGreaterThan(0);
	expect(document.documentElement.style.getPropertyValue(INSET_START)).not.toBe(
		'0rem',
	);
});

test('unmounting drops the subscription rather than leaking it', () => {
	const { unmount } = renderWithProviders(<WindowChromeSync />);

	unmount();

	expect(unsubscribed).toBeGreaterThan(0);
});

test('the component renders nothing of its own', () => {
	const { container } = renderWithProviders(<WindowChromeSync />);

	expect(container.textContent).toBe('');
});
