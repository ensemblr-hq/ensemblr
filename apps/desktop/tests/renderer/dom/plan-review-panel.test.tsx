// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PlanReviewPanel } from '@/renderer/components/workbench-shell/conversation-panel/plan-review-panel';
import { renderWithProviders } from '../support/dom';

const renderPanel = (
	props: Partial<Parameters<typeof PlanReviewPanel>[0]> = {},
) => {
	const onApprove = vi.fn();
	const onHandoff = vi.fn();
	const onRefine = vi.fn();
	renderWithProviders(
		<PlanReviewPanel
			onApprove={onApprove}
			onHandoff={onHandoff}
			onRefine={onRefine}
			{...props}
		/>,
	);
	return { onApprove, onHandoff, onRefine };
};

describe('PlanReviewPanel', () => {
	// The plan's own heading is the message right above the composer, so the bar
	// carries actions only — no title, no prose.
	it('carries nothing but the actions', () => {
		renderPanel();

		const panel = screen.getByRole('region', { name: 'Plan review' });

		expect(panel).toHaveTextContent(/^ApproveRefineHand off$/);
	});

	it('offers exactly the three ways forward', () => {
		renderPanel();

		expect(screen.getAllByRole('button')).toHaveLength(3);
		expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Refine' })).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Hand off' }),
		).toBeInTheDocument();
	});

	it('approves the plan', async () => {
		const { onApprove } = renderPanel();

		await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

		expect(onApprove).toHaveBeenCalledTimes(1);
	});

	it('hands the plan off to a new chat', async () => {
		const { onHandoff } = renderPanel();

		await userEvent.click(screen.getByRole('button', { name: 'Hand off' }));

		expect(onHandoff).toHaveBeenCalledTimes(1);
	});

	// Refine hands the user back their own composer rather than opening a second
	// text field: the agent has stopped, so the next message is a normal prompt.
	it('refines without asking for notes in the panel', async () => {
		const { onRefine } = renderPanel();

		await userEvent.click(screen.getByRole('button', { name: 'Refine' }));

		expect(onRefine).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole('textbox')).toBeNull();
	});

	it('locks every action while the handoff tab is being created', () => {
		renderPanel({ busy: true });

		for (const button of screen.getAllByRole('button')) {
			expect(button).toBeDisabled();
		}
	});
});
