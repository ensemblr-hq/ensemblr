// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { fireEvent, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { CleanupToggle } from '../../src/renderer/components/workbench-shell/cleanup-toggle';
import { renderWithProviders } from './support/dom';

test('reflects the unchecked state and reports the toggle on click', () => {
	const onCheckedChange = vi.fn();

	renderWithProviders(
		<CleanupToggle
			checked={false}
			description='Handoff files are preserved.'
			disabled={false}
			label='Also remove the worktree and drop the local branch'
			onCheckedChange={onCheckedChange}
		/>,
	);

	const checkbox = screen.getByRole('checkbox');
	expect(checkbox).not.toBeChecked();

	fireEvent.click(checkbox);
	expect(onCheckedChange).toHaveBeenCalledWith(true);
});

test('renders label and description inside one wrapping label element', () => {
	renderWithProviders(
		<CleanupToggle
			checked
			description='Handoff files are preserved.'
			disabled={false}
			label='Drop the local branch'
			onCheckedChange={vi.fn()}
		/>,
	);

	expect(screen.getByText('Drop the local branch')).toBeInTheDocument();
	expect(screen.getByText('Handoff files are preserved.')).toBeInTheDocument();
	expect(screen.getByRole('checkbox')).toBeChecked();
	expect(screen.getByRole('checkbox').closest('label')).not.toBeNull();
});

test('does not report a toggle while disabled', () => {
	const onCheckedChange = vi.fn();

	renderWithProviders(
		<CleanupToggle
			checked={false}
			description='Handoff files are preserved.'
			disabled
			label='Drop the local branch'
			onCheckedChange={onCheckedChange}
		/>,
	);

	const checkbox = screen.getByRole('checkbox');
	expect(checkbox).toBeDisabled();

	fireEvent.click(checkbox);
	expect(onCheckedChange).not.toHaveBeenCalled();
});
