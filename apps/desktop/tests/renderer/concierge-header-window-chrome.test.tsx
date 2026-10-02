// @vitest-environment happy-dom

import { getDefaultStore } from 'jotai';
import { act } from 'react';
import { afterEach, expect, test } from 'vitest';

import { ConciergePanelHeader } from '../../src/renderer/components/concierge/concierge-panel-header';
import { SidebarProvider } from '../../src/renderer/components/ui/sidebar';
import { readWindowChrome } from '../../src/renderer/lib/window-chrome';
import { windowChromeAtom } from '../../src/renderer/state/window-chrome';
import type { WindowChromeSnapshot } from '../../src/shared/window-chrome';
import { resolveWindowChrome } from '../../src/shared/window-chrome';
import { renderWithProviders } from './support/dom';

const SAFE_START = 'pl-(--ensemblr-window-chrome-safe-start)';

const store = getDefaultStore();

afterEach(() => {
	store.set(windowChromeAtom, readWindowChrome());
});

/**
 * Renders the header in the state that reaches the leading corner: the panel
 * maximized over a collapsed sidebar.
 * @param insetLeft - Where the covered inset starts, defaulting to the window's own edge.
 * @returns The rendered header element.
 */
function renderMaximizedHeader(insetLeft = 0): HTMLElement {
	const { container } = renderWithProviders(
		<SidebarProvider open={false}>
			<ConciergePanelHeader
				insetLeft={insetLeft}
				isClearing={false}
				isFullscreen={true}
				onClear={() => undefined}
				onClose={() => undefined}
				onPointerDown={() => undefined}
				onToggleFullscreen={() => undefined}
			/>
		</SidebarProvider>,
	);
	const header = container.querySelector('header');
	if (!header) {
		throw new Error('the Concierge header did not render');
	}
	return header;
}

/** Pushes a chrome snapshot the way main's broadcast would. */
function wear(chrome: WindowChromeSnapshot): void {
	act(() => {
		store.set(windowChromeAtom, chrome);
	});
}

test('macOS full screen lets the header take the corner the lights left', () => {
	store.set(windowChromeAtom, resolveWindowChrome('darwin', 'system', true));
	const header = renderMaximizedHeader();

	expect(header.classList.contains('pl-3')).toBe(true);
	expect(header.classList.contains(SAFE_START)).toBe(false);
});

// The regression this guards: the header used to read the chrome through a
// plain module read, so leaving full screen moved the inset without telling
// React, and the mark stayed under the traffic lights until an unrelated render.
test('leaving full screen pushes the header back clear of the traffic lights', () => {
	store.set(windowChromeAtom, resolveWindowChrome('darwin', 'system', true));
	const header = renderMaximizedHeader();

	wear(resolveWindowChrome('darwin', 'system', false));

	expect(header.classList.contains(SAFE_START)).toBe(true);
	expect(header.classList.contains('pl-3')).toBe(false);
});

test('macOS windowed clears the traffic lights from the first render', () => {
	store.set(windowChromeAtom, resolveWindowChrome('darwin', 'system'));
	const header = renderMaximizedHeader();

	expect(header.classList.contains(SAFE_START)).toBe(true);
});

test('a sidebar inset that already clears the lights keeps the plain gutter', () => {
	store.set(windowChromeAtom, resolveWindowChrome('darwin', 'system'));
	const header = renderMaximizedHeader(256);

	expect(header.classList.contains('pl-3')).toBe(true);
	expect(header.classList.contains(SAFE_START)).toBe(false);
});
