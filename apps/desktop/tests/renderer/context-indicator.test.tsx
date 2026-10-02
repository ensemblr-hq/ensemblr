// @vitest-environment happy-dom

import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { ContextIndicator } from '../../src/renderer/components/workbench-shell/conversation-panel/composer/context-indicator';
import type { ComposerPlanUsage } from '../../src/renderer/types/workbench';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

const SESSION_ID = 'agent-session-1';

afterEach(() => {
	clearEnsemblrApi();
});

/**
 * Renders to a markup string under the query client the card's refresh binding
 * needs, so a ring assertion reads the same tree the app mounts.
 * @param element - The card to render.
 * @returns The static markup.
 */
function markupOf(element: ReactElement): string {
	return renderToStaticMarkup(
		<QueryClientProvider client={createTestQueryClient()}>
			{element}
		</QueryClientProvider>,
	);
}

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
 * one window. The section lives inside the card, so it is not in the tree at all
 * until the trigger is pressed.
 * @param utilization - The reading the window carries, or null when unmeasured.
 * @returns The window's bar element.
 */
async function openPlanCard(utilization: number | null): Promise<HTMLElement> {
	renderWithProviders(
		<ContextIndicator planUsage={planUsage(utilization)} usage={null} />,
	);
	fireEvent.click(
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
	const markup = markupOf(
		<ContextIndicator usage={{ maxTokens: 258_400, usedTokens: 0 }} />,
	);

	expect(markup).not.toContain('stroke-dasharray');
});

test('renders context ring progress when tokens are used', () => {
	const markup = markupOf(
		<ContextIndicator usage={{ maxTokens: 100, usedTokens: 25 }} />,
	);

	expect(markup).toContain('stroke-dasharray="25, 100"');
});

test('leaves the context ring empty when usage is unknown', () => {
	const markup = markupOf(<ContextIndicator usage={null} />);

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

/** The gauge button the card hangs off. */
function cardTrigger(): HTMLElement {
	return screen.getByRole('button', { name: 'Context and plan usage' });
}

/**
 * Opens the card over a chat bound to a live session and hands back its refresh
 * control, which only a bound chat draws.
 * @returns The refresh button.
 */
async function openRefreshableCard(): Promise<HTMLElement> {
	renderWithProviders(
		<ContextIndicator
			liveSessionId={SESSION_ID}
			planUsage={planUsage(41)}
			usage={null}
		/>,
	);
	fireEvent.click(cardTrigger());
	return await screen.findByRole('button', { name: 'Refresh plan usage' });
}

test('asks the chat’s own session to re-read the plan on demand', async () => {
	const refreshAgentPlanUsage = vi.fn(async () => ({ refreshed: true }));
	installEnsemblrApi({ refreshAgentPlanUsage });

	fireEvent.click(await openRefreshableCard());

	await waitFor(() =>
		expect(refreshAgentPlanUsage).toHaveBeenCalledWith({
			sessionId: SESSION_ID,
		}),
	);
});

test('spins the refresh control until the runtime answers', async () => {
	let answer: () => void = () => undefined;
	installEnsemblrApi({
		refreshAgentPlanUsage: () =>
			new Promise((resolve) => {
				answer = () => resolve({ refreshed: true });
			}),
	});
	const refresh = await openRefreshableCard();

	fireEvent.click(refresh);

	const icon = await waitFor(() => {
		const spinning = refresh.querySelector('.animate-spin');
		expect(spinning).not.toBeNull();
		return spinning;
	});
	expect(refresh).toBeDisabled();
	answer();
	await waitFor(() => expect(icon?.className).not.toContain('animate-spin'));
});

test('keeps the control spinning across a close and reopen of the card', async () => {
	let answer: () => void = () => undefined;
	const refreshAgentPlanUsage = vi.fn(
		() =>
			new Promise<{ refreshed: boolean }>((resolve) => {
				answer = () => resolve({ refreshed: true });
			}),
	);
	installEnsemblrApi({ refreshAgentPlanUsage });

	fireEvent.click(await openRefreshableCard());
	fireEvent.keyDown(document.body, { key: 'Escape' });
	await waitFor(() =>
		expect(
			screen.queryByRole('button', { name: 'Refresh plan usage' }),
		).toBeNull(),
	);
	fireEvent.click(cardTrigger());
	const reopened = await screen.findByRole('button', {
		name: 'Refresh plan usage',
	});

	expect(reopened).toBeDisabled();
	expect(reopened.querySelector('.animate-spin')).not.toBeNull();
	fireEvent.click(reopened);
	expect(refreshAgentPlanUsage).toHaveBeenCalledTimes(1);
	answer();
	await waitFor(() => expect(reopened).not.toBeDisabled());
});

test('offers no refresh control to a chat whose runtime is not attached', async () => {
	renderWithProviders(
		<ContextIndicator
			liveSessionId={null}
			planUsage={planUsage(41)}
			usage={null}
		/>,
	);
	fireEvent.click(cardTrigger());
	await screen.findByRole('progressbar', { name: 'Session' });

	expect(
		screen.queryByRole('button', { name: 'Refresh plan usage' }),
	).toBeNull();
});

test('survives focus leaving the trigger, so the control can be tabbed to', async () => {
	installEnsemblrApi({
		refreshAgentPlanUsage: async () => ({ refreshed: true }),
	});
	const refresh = await openRefreshableCard();

	fireEvent.blur(cardTrigger());
	refresh.focus();

	expect(document.activeElement).toBe(refresh);
	expect(screen.getByText('Plan usage')).toBeVisible();
});
