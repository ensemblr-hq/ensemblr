// @vitest-environment happy-dom

/**
 * Plan usage shares the context popover rather than getting a gauge of its own,
 * so the card has to carry both halves without either one hiding the other — and
 * has to stay a plain context gauge for a runtime that reports no plan at all.
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';

import { ContextIndicator } from '@/renderer/components/workbench-shell/conversation-panel/composer/context-indicator';
import type { ComposerPlanUsage } from '@/renderer/types/workbench';
import { renderWithProviders } from '../support/dom';

const CONTEXT = { maxTokens: 200_000, usedTokens: 50_000 };

/** Plan usage as a Max session reports it partway through a five-hour window. */
function planUsage(overrides: Partial<ComposerPlanUsage> = {}) {
	return {
		limits: [
			{
				displayName: null,
				id: 'five_hour',
				resetsAt: null,
				utilization: 62,
			},
			{ displayName: 'Fable', id: 'Fable', resetsAt: null, utilization: null },
		],
		status: 'allowed',
		totalCostUsd: 1.284,
		...overrides,
	} satisfies ComposerPlanUsage;
}

/** Renders the gauge and hovers its trigger so the card's content is queryable. */
async function openCard(
	plan: ComposerPlanUsage | null,
	label = 'Context and plan usage',
): Promise<void> {
	renderWithProviders(<ContextIndicator planUsage={plan} usage={CONTEXT} />);
	await userEvent.hover(screen.getByLabelText(label));
}

test('shows every reported window and the running cost alongside the context', async () => {
	await openCard(planUsage());

	expect(await screen.findByText('Context')).toBeVisible();
	expect(await screen.findByText('Plan usage')).toBeVisible();
	expect(await screen.findByText('$1.28')).toBeVisible();
	expect(await screen.findByText('Session')).toBeVisible();
	expect(await screen.findByText('62%')).toBeVisible();
});

test('names a per-model bucket by the label the server gave it', async () => {
	await openCard(planUsage());

	expect(await screen.findByText('Fable')).toBeVisible();
});

test('stays a plain context gauge for a runtime that reports no plan usage', async () => {
	await openCard(null, 'Context usage');

	expect(await screen.findByText('Context')).toBeVisible();
	expect(screen.queryByText('Plan usage')).toBeNull();
});

test('shows the cost before any window has been reported', async () => {
	await openCard(planUsage({ limits: [] }));

	expect(await screen.findByText('Plan usage')).toBeVisible();
	expect(await screen.findByText('$1.28')).toBeVisible();
});

test('keeps a third digit on a sub-dollar cost, which most turns are', async () => {
	await openCard(planUsage({ totalCostUsd: 0.037 }));

	expect(await screen.findByText('$0.037')).toBeVisible();
});

test('says nothing extra while the plan is simply spendable', async () => {
	await openCard(planUsage());

	expect(screen.queryByText(/Close to the plan limit/)).toBeNull();
	expect(screen.queryByText(/Plan limit reached/)).toBeNull();
});

test('warns when the runtime says the account is near its ceiling', async () => {
	await openCard(planUsage({ status: 'allowed-warning' }));

	expect(await screen.findByText('Close to the plan limit.')).toBeVisible();
});

test('says turns will fail once the runtime rejects the plan', async () => {
	await openCard(planUsage({ status: 'rejected' }));

	expect(
		await screen.findByText(
			'Plan limit reached. Turns fail until a window resets.',
		),
	).toBeVisible();
});

test('names an overage window rather than printing its runtime id', async () => {
	await openCard(
		planUsage({
			limits: [
				{
					displayName: null,
					id: 'seven_day_overage_included',
					resetsAt: null,
					utilization: 40,
				},
				{ displayName: null, id: 'overage', resetsAt: null, utilization: 12 },
			],
		}),
	);

	expect(await screen.findByText('Weekly (extra usage)')).toBeVisible();
	expect(await screen.findByText('Extra usage')).toBeVisible();
	expect(screen.queryByText(/seven_day_overage_included/)).toBeNull();
});
