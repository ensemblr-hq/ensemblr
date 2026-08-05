// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { RunScriptsSection } from '@/renderer/components/settings/run-scripts/run-scripts-section';
import type { RunScriptDefinition } from '@/shared/scripts';

import { renderWithProviders } from './support/dom';

const DEV: RunScriptDefinition = {
	availableIn: ['local'],
	command: 'npm run dev',
	icon: 'server',
	isDefault: true,
	name: 'dev',
};

const TEST: RunScriptDefinition = {
	availableIn: null,
	command: 'npm test',
	icon: 'test-tube',
	isDefault: false,
	name: 'test',
};

test('every configured run script is editable and deletable', () => {
	renderWithProviders(
		<RunScriptsSection onChange={vi.fn()} scripts={[DEV, TEST]} />,
	);

	expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
	expect(screen.getByRole('button', { name: 'Edit dev' })).toBeEnabled();
	expect(screen.getByRole('button', { name: 'Delete dev' })).toBeEnabled();
	expect(screen.getByRole('button', { name: 'Edit test' })).toBeEnabled();
});

test('does not claim the committed config makes the list read-only', () => {
	renderWithProviders(<RunScriptsSection onChange={vi.fn()} scripts={[DEV]} />);

	expect(screen.queryByText(/Remove the \[scripts\.run\] tables/)).toBeNull();
	expect(screen.queryByText(/edit these locally/)).toBeNull();
});

test('deleting a script reports the remaining list', async () => {
	const onChange = vi.fn();
	const user = userEvent.setup();
	renderWithProviders(
		<RunScriptsSection onChange={onChange} scripts={[DEV, TEST]} />,
	);

	await user.click(screen.getByRole('button', { name: 'Delete dev' }));

	expect(onChange).toHaveBeenCalledWith([TEST]);
});
