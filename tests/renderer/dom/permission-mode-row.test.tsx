// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { PermissionModeRow } from '@/renderer/components/settings/permission-mode-row';

import { renderWithProviders } from '../support/dom';

describe('PermissionModeRow', () => {
	test('shows the active mode and the description that belongs to it', () => {
		renderWithProviders(
			<PermissionModeRow
				mode='read-only'
				onChange={vi.fn()}
				onReset={vi.fn()}
				source='ensemblr-config'
			/>,
		);

		expect(screen.getByText('Read only')).toBeInTheDocument();
		expect(
			screen.getByText(
				'Agents may read the workspace but cannot write, run commands, or drive the app.',
			),
		).toBeInTheDocument();
	});

	test('names the source the value resolved from', () => {
		renderWithProviders(
			<PermissionModeRow
				mode='workspace-trusted'
				onChange={vi.fn()}
				onReset={vi.fn()}
				source='ensemblr-config'
			/>,
		);

		expect(
			screen.getByText(/source: \.ensemblr\/settings\.toml/),
		).toBeInTheDocument();
	});

	test('reads "not set" when nothing resolved', () => {
		renderWithProviders(
			<PermissionModeRow
				mode='workspace-trusted'
				onChange={vi.fn()}
				onReset={vi.fn()}
				source={undefined}
			/>,
		);

		expect(screen.getByText('not set')).toBeInTheDocument();
	});

	test('a committed value offers no reset — there is no personal row to clear', () => {
		renderWithProviders(
			<PermissionModeRow
				mode='read-only'
				onChange={vi.fn()}
				onReset={vi.fn()}
				source='ensemblr-config'
			/>,
		);

		expect(
			screen.queryByRole('button', { name: 'Revert to default' }),
		).not.toBeInTheDocument();
	});

	test('a personal sqlite override offers a reset', async () => {
		const onReset = vi.fn();
		renderWithProviders(
			<PermissionModeRow
				mode='read-only'
				onChange={vi.fn()}
				onReset={onReset}
				source='sqlite'
			/>,
		);

		await userEvent.click(
			screen.getByRole('button', { name: 'Revert to default' }),
		);
		expect(onReset).toHaveBeenCalledTimes(1);
	});

	test('choosing a mode reports the validated value', async () => {
		const onChange = vi.fn();
		renderWithProviders(
			<PermissionModeRow
				mode='workspace-trusted'
				onChange={onChange}
				onReset={vi.fn()}
				source='sqlite'
			/>,
		);

		await userEvent.click(screen.getByRole('combobox'));
		await userEvent.click(
			await screen.findByRole('option', { name: 'Approval required' }),
		);

		expect(onChange).toHaveBeenCalledWith('approval-required');
	});

	test('every permission mode is offered', async () => {
		renderWithProviders(
			<PermissionModeRow
				mode='workspace-trusted'
				onChange={vi.fn()}
				onReset={vi.fn()}
				source='sqlite'
			/>,
		);

		await userEvent.click(screen.getByRole('combobox'));

		expect(await screen.findAllByRole('option')).toHaveLength(3);
	});
});
