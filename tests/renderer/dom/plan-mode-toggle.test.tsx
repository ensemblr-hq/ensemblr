// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PlanModeToggle } from '@/renderer/components/workbench-shell/conversation-panel/composer/plan-mode-toggle';
import { renderWithProviders } from '../support/dom';

const renderToggle = (
	props: Partial<Parameters<typeof PlanModeToggle>[0]> = {},
) => {
	const onChange = vi.fn();
	renderWithProviders(
		<PlanModeToggle onChange={onChange} value={false} {...props} />,
	);
	return { onChange };
};

describe('PlanModeToggle', () => {
	it('shows an icon-only chip while plan mode is off', () => {
		renderToggle();

		const button = screen.getByRole('button', { name: /plan mode: off/i });
		expect(button).toHaveAttribute('aria-pressed', 'false');
		expect(button).not.toHaveTextContent('Plan');
	});

	it('labels the chip once plan mode is on', () => {
		renderToggle({ value: true });

		const button = screen.getByRole('button', { name: /plan mode: on/i });
		expect(button).toHaveAttribute('aria-pressed', 'true');
		expect(button).toHaveTextContent('Plan');
	});

	it('turns plan mode on when clicked while off', async () => {
		const { onChange } = renderToggle();

		await userEvent.click(screen.getByRole('button'));

		expect(onChange).toHaveBeenCalledWith(true);
	});

	it('turns plan mode off when clicked while on', async () => {
		const { onChange } = renderToggle({ value: true });

		await userEvent.click(screen.getByRole('button'));

		expect(onChange).toHaveBeenCalledWith(false);
	});

	// The `subtle` Button variant styles `aria-pressed:` grey; an unprefixed
	// accent class loses to it, leaving an "on" chip that looks off.
	it('tints itself under the aria-pressed variant so the accent wins', () => {
		renderToggle({ value: true });

		expect(screen.getByRole('button').className).toContain(
			'aria-pressed:text-accent-strong',
		);
	});

	it('cannot be toggled while the composer pickers are disabled', async () => {
		const { onChange } = renderToggle({ disabled: true });

		await userEvent.click(screen.getByRole('button'));

		expect(onChange).not.toHaveBeenCalled();
	});
});
