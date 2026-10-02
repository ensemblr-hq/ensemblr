// @vitest-environment happy-dom

import { expect, test } from 'vitest';

import { SidebarProvider } from '../../src/renderer/components/ui/sidebar';
import { NavigationSidebarHeader } from '../../src/renderer/components/workbench-shell/navigation-sidebar/navigation-sidebar-header';
import { resolveWindowChrome } from '../../src/shared/window-chrome';
import { renderWithProviders } from './support/dom';

const WORDMARK = '[data-slot="ensemblr-wordmark"]';

/**
 * Renders the strip inside the sidebar context its trigger reads.
 * @param showsWordmark - Whether the platform leaves the leading corner empty.
 * @returns The rendered container.
 */
function renderHeader(showsWordmark: boolean): HTMLElement {
	const { container } = renderWithProviders(
		<SidebarProvider>
			<NavigationSidebarHeader showsWordmark={showsWordmark} />
		</SidebarProvider>,
	);
	return container;
}

test('draws the wordmark where the platform leaves the leading corner empty', () => {
	const container = renderHeader(true);

	expect(container.querySelector(WORDMARK)).not.toBeNull();
	expect(
		container.querySelector('[data-slot="sidebar-trigger"]'),
	).not.toBeNull();
});

test('leaves the strip bare where the system draws its own window chrome', () => {
	const container = renderHeader(false);

	expect(container.querySelector(WORDMARK)).toBeNull();
	expect(
		container.querySelector('[data-slot="sidebar-trigger"]'),
	).not.toBeNull();
});

test('the wordmark is decorative rather than a second name for the window', () => {
	const wordmark = renderHeader(true).querySelector(WORDMARK);

	expect(wordmark?.getAttribute('aria-hidden')).toBe('true');
});

test('only macOS reserves the corner the wordmark would take', () => {
	expect(resolveWindowChrome('darwin', 'system').insets.start).toBeGreaterThan(
		0,
	);
	expect(resolveWindowChrome('linux', 'system').insets.start).toBe(0);
	expect(resolveWindowChrome('linux', 'custom').insets.start).toBe(0);
});

test('macOS full screen frees the corner, so the wordmark takes it', () => {
	expect(resolveWindowChrome('darwin', 'system', true).insets.start).toBe(0);
});

test('full screen leaves the title bar Ensemblr draws itself alone', () => {
	const fullScreen = resolveWindowChrome('linux', 'custom', true);

	expect(fullScreen.insets.top).toBe(
		resolveWindowChrome('linux', 'custom').insets.top,
	);
	expect(fullScreen.drawsOwnControls).toBe(true);
});
