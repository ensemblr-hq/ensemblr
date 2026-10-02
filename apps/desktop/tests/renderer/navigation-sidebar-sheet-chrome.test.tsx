// @vitest-environment happy-dom

/**
 * Below the `md` breakpoint the navigation sidebar stops being a column and
 * becomes a sheet, and a sheet pins itself to the viewport's top edge — which on
 * Linux with Ensemblr's own title bar is the strip the window controls live in.
 * The stylesheet offsets side sheets below it, but the sidebar's sheet stamps
 * `data-slot="sidebar"` over the primitive's `sheet-content`, so it slipped the
 * rule and opened with its first row (Dashboard) under the title bar and
 * unclickable.
 *
 * That clobbered slot is the blind spot in both rules keyed on it: the second
 * takes a sheet's own chrome back out of the window-drag region, which on macOS
 * is what stops the empty half of the strip dragging the window out from under
 * the open sheet.
 *
 * These tests run the shipped rules' own selector lists against the elements the
 * primitive actually renders, rather than a copy of either, so re-vendoring the
 * sheet or the sidebar surfaces here instead of on a narrow window.
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import {
	Sidebar,
	SidebarProvider,
	SidebarTrigger,
} from '@/renderer/components/ui/sidebar';

import { renderWithProviders } from './support/dom';
import { readStyleRule } from './support/stylesheet';

const viewport = vi.hoisted(() => ({ mobile: true }));

vi.mock('@/renderer/hooks/use-mobile', () => ({
	useIsMobile: () => viewport.mobile,
}));

/**
 * Reads the selector list of one rule out of the shipped stylesheet. The
 * declarations are pinned by `window-chrome-clearance.test.ts`; what is asked
 * here is who the selectors reach.
 * @param anchor - The rule's first selector, written as the stylesheet writes it.
 * @returns The rule's selectors, comma-joined for `Element.matches`.
 */
function selectorsOf(anchor: string): string {
	const rule = readStyleRule(anchor);

	if (!rule) {
		throw new Error(`The rule anchored on \`${anchor}\` left index.css.`);
	}

	return rule.selectors;
}

/**
 * Renders the sidebar primitive at the given viewport and returns the root the
 * chrome rules have to reach: the sheet when it is one, the static wrapper when
 * it is not. It is given the title-bar strip `NavigationSidebarHeader` draws, so
 * the rule that reaches inside the sheet has something to match.
 * @param mobile - Whether the viewport is below the sheet breakpoint.
 * @returns The element the stylesheet is asked about.
 */
async function renderSidebarRoot(mobile: boolean): Promise<Element> {
	viewport.mobile = mobile;
	const { container } = renderWithProviders(
		<SidebarProvider>
			<SidebarTrigger />
			<Sidebar collapsible='offcanvas'>
				<div className='window-chrome-spacer' />
			</Sidebar>
		</SidebarProvider>,
	);

	if (!mobile) {
		const wrapper = container.querySelector('[data-slot="sidebar"]');
		if (!wrapper) {
			throw new Error('The desktop sidebar rendered no wrapper.');
		}
		return wrapper;
	}

	await userEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
	return screen.getByRole('dialog');
}

/**
 * Finds the rendered title-bar strip, wherever the primitive put it — the sheet
 * is portalled, so the render's own container does not contain it.
 * @returns The sidebar's `window-chrome-spacer` element.
 */
function sidebarStrip(): Element {
	const strip = document.querySelector('.window-chrome-spacer');

	if (!strip) {
		throw new Error('The sidebar rendered no window-chrome-spacer strip.');
	}

	return strip;
}

test('the sidebar sheet is one of the surfaces held below the title bar', async () => {
	const selector = selectorsOf('[data-slot="sheet-content"][data-side="left"]');

	expect(await renderSidebarRoot(true)).toSatisfy((element: Element) =>
		element.matches(selector),
	);
});

test('the desktop sidebar wrapper is not, since it is not pinned to the viewport', async () => {
	const selector = selectorsOf('[data-slot="sheet-content"][data-side="left"]');

	expect(await renderSidebarRoot(false)).toSatisfy(
		(element: Element) => !element.matches(selector),
	);
});

test('the strip inside that sheet is taken back out of the window-drag region', async () => {
	const selector = selectorsOf('[data-slot="sheet-content"] .native-toolbar');
	await renderSidebarRoot(true);

	expect(sidebarStrip()).toSatisfy((element: Element) =>
		element.matches(selector),
	);
});
