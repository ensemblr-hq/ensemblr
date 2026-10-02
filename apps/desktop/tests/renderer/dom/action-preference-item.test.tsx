// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { ActionPreferenceItem } from '@/renderer/components/settings/action-preference-item';
import { Accordion } from '@/renderer/components/ui/accordion';

import { renderWithProviders } from '../support/dom';

/** Renders one item inside the Accordion it needs as a parent, expanded. */
function renderItem(
	props: Partial<Parameters<typeof ActionPreferenceItem>[0]>,
) {
	return renderWithProviders(
		<Accordion collapsible defaultValue='createPr' type='single'>
			<ActionPreferenceItem
				actionKey='createPr'
				description='Custom instructions for opening pull requests.'
				onChange={vi.fn()}
				onClear={vi.fn()}
				personal=''
				shared=''
				sharedSource={undefined}
				title='Create PR'
				{...props}
			/>
		</Accordion>,
	);
}

describe('ActionPreferenceItem', () => {
	test('with no personal text, the shared text fills the placeholder', () => {
		renderItem({
			shared: 'Always link the issue.',
			sharedSource: 'ensemblr-config',
		});

		expect(screen.getByLabelText('Create PR')).toHaveAttribute(
			'placeholder',
			'Always link the issue.',
		);
	});

	test('with no shared text either, the generic placeholder shows', () => {
		renderItem({});

		expect(screen.getByLabelText('Create PR')).toHaveAttribute(
			'placeholder',
			expect.stringContaining('Add your preferences here'),
		);
	});

	test('a shared value badges the source it resolved from', () => {
		renderItem({
			shared: 'Always link the issue.',
			sharedSource: 'ensemblr-config',
		});

		expect(
			screen.getByText(/source: \.ensemblr\/settings\.toml/),
		).toBeInTheDocument();
	});

	test('no shared value badges "not set"', () => {
		renderItem({});

		expect(screen.getByText('not set')).toBeInTheDocument();
	});

	test('a personal value wins the badge and exposes a clear button', async () => {
		const onClear = vi.fn();
		renderItem({
			onClear,
			personal: 'Mine.',
			shared: 'Theirs.',
			sharedSource: 'ensemblr-config',
		});

		expect(
			screen.getByText('source: personal (this device)'),
		).toBeInTheDocument();
		expect(screen.getByLabelText('Create PR')).toHaveValue('Mine.');

		await userEvent.click(
			screen.getByRole('button', { name: 'Remove Create PR' }),
		);
		expect(onClear).toHaveBeenCalledTimes(1);
	});

	test('whitespace-only personal text does not count as a personal value', () => {
		renderItem({ personal: '   ', shared: 'Theirs.', sharedSource: 'sqlite' });

		expect(
			screen.queryByRole('button', { name: 'Remove Create PR' }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByText('source: personal (this device)'),
		).not.toBeInTheDocument();
	});

	test('typing reports each change to the caller', async () => {
		const onChange = vi.fn();
		renderItem({ onChange });

		await userEvent.type(screen.getByLabelText('Create PR'), 'hi');

		expect(onChange).toHaveBeenCalledTimes(2);
		expect(onChange).toHaveBeenLastCalledWith('i');
	});
});
