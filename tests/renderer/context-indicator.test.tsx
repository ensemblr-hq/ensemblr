// @vitest-environment happy-dom

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ContextIndicator } from '../../src/renderer/components/workbench-shell/conversation-panel/composer/context-indicator';
import type { ComposerPlanUsage } from '../../src/renderer/types/workbench';
import { renderWithProviders } from './support/dom';

/** A plan snapshot carrying one window at the given reading. */
function planUsage(utilization: number | null): ComposerPlanUsage {
	return {
		limits: [
			{ displayName: null, id: 'five_hour', resetsAt: null, utilization },
		],
		status: null,
		totalCostUsd: null,
	};
}

/**
 * Opens the card over a plan snapshot and hands back the bar it drew for the
 * one window. The section lives inside the hover card, so it is not in the tree
 * at all until the trigger is entered.
 * @param utilization - The reading the window carries, or null when unmeasured.
 * @returns The window's bar element.
 */
async function openPlanCard(utilization: number | null): Promise<HTMLElement> {
	renderWithProviders(
		<ContextIndicator planUsage={planUsage(utilization)} usage={null} />,
	);
	fireEvent.pointerEnter(
		screen.getByRole('button', { name: 'Context and plan usage' }),
	);
	return await waitFor(() =>
		screen.getByRole('progressbar', { name: 'Session' }),
	);
}

/**
 * The filled part of a window's bar, which only a measured window has.
 * @param bar - The bar drawn for one plan window.
 * @returns The indicator, or null when the window was drawn hollow.
 */
function indicatorOf(bar: HTMLElement): Element | null {
	return bar.querySelector('[data-slot="progress-indicator"]');
}

test('leaves the context ring empty when no tokens are used', () => {
	const markup = renderToStaticMarkup(
		<ContextIndicator usage={{ maxTokens: 258_400, usedTokens: 0 }} />,
	);

	expect(markup).not.toContain('stroke-dasharray');
});

test('renders context ring progress when tokens are used', () => {
	const markup = renderToStaticMarkup(
		<ContextIndicator usage={{ maxTokens: 100, usedTokens: 25 }} />,
	);

	expect(markup).toContain('stroke-dasharray="25, 100"');
});

test('leaves the context ring empty when usage is unknown', () => {
	const markup = renderToStaticMarkup(<ContextIndicator usage={null} />);

	expect(markup).not.toContain('stroke-dasharray');
	expect(markup).toContain('Context usage gauge');
});

test('fills a measured plan window to its reading', async () => {
	const bar = await openPlanCard(41);

	expect(indicatorOf(bar)?.getAttribute('style')).toContain('translateX(-59%)');
	expect(bar.className).not.toContain('border-dashed');
});

test('draws a window measured at zero as a solid empty track', async () => {
	const bar = await openPlanCard(0);

	expect(indicatorOf(bar)?.getAttribute('style')).toContain(
		'translateX(-100%)',
	);
	expect(bar.className).not.toContain('border-dashed');
});

test('draws an unmeasured plan window hollow rather than as a bar at zero', async () => {
	const bar = await openPlanCard(null);

	expect(bar.className).toContain('border-dashed');
	expect(bar.className).toContain('bg-transparent');
});
