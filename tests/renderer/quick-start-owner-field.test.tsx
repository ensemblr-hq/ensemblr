// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import { beforeAll, expect, test, vi } from 'vitest';

import { QuickStartOwnerField } from '../../src/renderer/components/welcome/quick-start-owner-field';
import type { GithubOwnerEntry } from '../../src/shared/ipc/contracts/quick-start';
import { renderWithProviders } from './support/dom';

beforeAll(() => {
	// Radix Select drives its trigger from pointer events and scrolls the
	// highlighted item into view; happy-dom implements neither.
	Element.prototype.hasPointerCapture = () => false;
	Element.prototype.setPointerCapture = () => {};
	Element.prototype.releasePointerCapture = () => {};
	Element.prototype.scrollIntoView = () => {};
});

function owner(overrides: Partial<GithubOwnerEntry> = {}): GithubOwnerEntry {
	return {
		avatarUrl: null,
		canCreate: true,
		displayName: null,
		kind: 'organization',
		login: 'ensemblr-hq',
		restriction: null,
		...overrides,
	};
}

const VIEWER = owner({ kind: 'user', login: 'psoldunov' });

/** Opens the Radix trigger the way it listens for it: a primary pointerdown. */
function openPicker(): void {
	fireEvent.pointerDown(screen.getByRole('combobox'), {
		button: 0,
		ctrlKey: false,
		pointerType: 'mouse',
	});
}

function renderField(owners: GithubOwnerEntry[], onSelect = vi.fn()) {
	renderWithProviders(
		<QuickStartOwnerField
			disabled={false}
			loading={false}
			onSelect={onSelect}
			owners={owners}
			value={owners[0]?.login ?? ''}
		/>,
	);
	return onSelect;
}

test('renders nothing when there is no owner to choose between', () => {
	const { container } = renderWithProviders(
		<QuickStartOwnerField
			disabled={false}
			loading={false}
			onSelect={vi.fn()}
			owners={[]}
			value=''
		/>,
	);

	expect(container).toBeEmptyDOMElement();
});

test('holds the row while gh is still answering, so the dialog cannot reflow', () => {
	renderWithProviders(
		<QuickStartOwnerField
			disabled={false}
			loading
			onSelect={vi.fn()}
			owners={[]}
			value=''
		/>,
	);

	expect(screen.getByText(/reading github accounts/i)).toBeInTheDocument();
	expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

test('shows the selected owner on the closed trigger', () => {
	renderField([VIEWER, owner()]);

	expect(screen.getByRole('combobox')).toHaveTextContent('psoldunov');
});

test('offers every owner, with the blocked ones disabled and explained', () => {
	renderField([
		VIEWER,
		owner({ displayName: 'Ensemblr' }),
		owner({
			canCreate: false,
			login: 'locked-org',
			restriction: {
				code: 'owner-create-restricted',
				message: 'locked-org reserves repository creation for its owners.',
			},
		}),
		owner({
			canCreate: false,
			login: 'the-set-set',
			restriction: {
				code: 'owner-access-restricted',
				message: 'the-set-set is not reachable with the current gh token.',
			},
		}),
	]);

	openPicker();

	const options = screen.getAllByRole('option');
	expect(options.map((option) => option.textContent)).toEqual([
		expect.stringContaining('psoldunov'),
		expect.stringContaining('Ensemblr'),
		expect.stringContaining('Owners only'),
		expect.stringContaining('No access'),
	]);
	expect(screen.getByRole('option', { name: /locked-org/ })).toHaveAttribute(
		'aria-disabled',
		'true',
	);
	expect(screen.getByRole('option', { name: /the-set-set/ })).toHaveAttribute(
		'aria-disabled',
		'true',
	);
	expect(
		screen.getByRole('option', { name: /ensemblr-hq/ }),
	).not.toHaveAttribute('aria-disabled', 'true');
});

test('reports the picked owner to its caller', () => {
	const onSelect = renderField([VIEWER, owner()]);

	openPicker();
	fireEvent.click(screen.getByRole('option', { name: /ensemblr-hq/ }));

	expect(onSelect).toHaveBeenCalledWith('ensemblr-hq');
});
