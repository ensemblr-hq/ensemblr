// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { LinearIssueFilterBar } from '@/renderer/components/linear/issue-list-toolbar';
import { ALL_ACCOUNTS, ALL_TEAMS } from '@/renderer/lib/linear';
import {
	createLinearAccountFixture,
	createLinearTeamFixture,
} from '../fixtures/linear';
import { renderWithProviders } from './support/dom';

const ACCOUNTS = [
	createLinearAccountFixture({ id: 'account-1' }),
	createLinearAccountFixture({ id: 'account-2' }),
];

const TEAMS = [
	createLinearTeamFixture({ accountId: 'account-1', id: 'team-1' }),
];

/** Renders the filter bar unnarrowed, letting each test override one facet. */
function renderBar(
	overrides: Partial<Parameters<typeof LinearIssueFilterBar>[0]> = {},
) {
	const onClearFilters = vi.fn();
	const props = {
		accountId: ALL_ACCOUNTS,
		accounts: ACCOUNTS,
		onAccountChange: vi.fn(),
		onClearFilters,
		onNewIssue: vi.fn(),
		onQueryChange: vi.fn(),
		onRefresh: vi.fn(),
		onTeamChange: vi.fn(),
		query: '',
		refreshing: false,
		showAccounts: true,
		teamId: ALL_TEAMS,
		teams: TEAMS,
		...overrides,
	};

	renderWithProviders(<LinearIssueFilterBar {...props} />);

	return { onClearFilters, props };
}

/** The reset control, or null when nothing is narrowed and it is not rendered. */
function clearButton(): HTMLElement | null {
	return screen.queryByRole('button', { name: 'Clear filters' });
}

describe('LinearIssueFilterBar', () => {
	test('renders the search box and both pickers', () => {
		renderBar();

		expect(
			screen.getByRole('textbox', { name: 'Search Linear issues' }),
		).toBeInTheDocument();
		expect(screen.getAllByRole('combobox')).toHaveLength(2);
	});

	test('hides the reset control when nothing is narrowed', () => {
		renderBar();

		expect(clearButton()).toBeNull();
	});

	test.each([
		['search', { query: 'oauth' }],
		['account', { accountId: 'account-1' }],
		['team', { teamId: 'team-1' }],
	])('offers the reset control when the %s is set', (_facet, overrides) => {
		renderBar(overrides);

		expect(clearButton()).toBeInTheDocument();
	});

	test('resets through the control', async () => {
		const { onClearFilters } = renderBar({ query: 'oauth' });

		const button = clearButton();
		expect(button).not.toBeNull();
		await userEvent.click(button as HTMLElement);

		expect(onClearFilters).toHaveBeenCalledTimes(1);
	});

	// The team picker hides itself when there are no options, so without this the
	// held team would narrow the list with nothing on screen to clear it.
	test('still offers the reset control when the team picker is hidden', () => {
		renderBar({ teamId: 'team-1', teams: [] });

		expect(screen.getAllByRole('combobox')).toHaveLength(1);
		expect(clearButton()).toBeInTheDocument();
	});

	test('hides the account picker when there is nothing to choose between', () => {
		renderBar({ showAccounts: false });

		expect(screen.getAllByRole('combobox')).toHaveLength(1);
	});

	test('reports every keystroke to the search handler', async () => {
		const { props } = renderBar();

		await userEvent.type(
			screen.getByRole('textbox', { name: 'Search Linear issues' }),
			'oa',
		);

		expect(props.onQueryChange).toHaveBeenCalledTimes(2);
	});
});
