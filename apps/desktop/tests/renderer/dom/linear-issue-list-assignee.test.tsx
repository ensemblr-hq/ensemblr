// @vitest-environment happy-dom

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { LinearIssueList } from '@/renderer/components/linear/issue-list';
import { LINEAR_ISSUE_FILTERS_STORAGE_KEY } from '@/renderer/state/linear';
import type {
	GetLinearMetadataResult,
	ListLinearIssuesResult,
} from '@/shared/ipc/contracts/linear';
import {
	createLinearAccountFixture,
	createLinearConnectionFixture,
	createLinearIssueFixture,
} from '../../fixtures/linear';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	installLocalStorage,
	renderWithProviders,
} from '../support/dom';

// Opening a row navigates to the issue; no router is mounted here.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tanstack/react-router')>()),
	useNavigate: () => vi.fn(),
}));

const ISSUES: ListLinearIssuesResult = {
	accountFailures: [],
	issues: [
		createLinearIssueFixture({
			assigneeId: 'viewer',
			assigneeName: 'Me Myself',
			id: 'mine',
			identifier: 'ENG-1',
			title: 'My own ticket',
		}),
		createLinearIssueFixture({
			assigneeId: 'bob',
			assigneeName: 'Bob',
			id: 'bobs',
			identifier: 'ENG-2',
			title: 'Bob ticket',
		}),
	],
	source: 'cache',
	status: 'ok',
};

const METADATA: GetLinearMetadataResult = {
	accountFailures: [],
	metadata: {
		cycles: [],
		labels: [],
		projects: [],
		states: [],
		syncedAt: null,
		teams: [],
		users: [],
	},
	status: 'ok',
};

beforeEach(() => {
	installLocalStorage();
	installEnsemblrApi({
		linearConnectionStatus: async () =>
			createLinearConnectionFixture({
				accounts: [createLinearAccountFixture({ userId: 'viewer' })],
			}),
		linearListIssues: async () => ISSUES,
		linearMetadata: async () => METADATA,
	});
});

afterEach(() => {
	clearEnsemblrApi();
});

/** Renders the browse list against a store of its own, as a cold start would. */
function renderList() {
	return renderWithProviders(
		<Provider store={createStore()}>
			<LinearIssueList />
		</Provider>,
	);
}

/**
 * Picks one row of the assignee facet's popover.
 * @param name - Accessible name of the row to pick
 */
async function pickAssignee(name: string) {
	await userEvent.click(screen.getByRole('button', { name: 'Assignee' }));
	await userEvent.click(await screen.findByRole('option', { name }));
	await userEvent.keyboard('{Escape}');
}

test('narrows the list to the user’s own issues and remembers it', async () => {
	renderList();
	expect(await screen.findByText('Bob ticket')).toBeInTheDocument();

	await pickAssignee('Me');

	expect(screen.getByText('My own ticket')).toBeInTheDocument();
	expect(screen.queryByText('Bob ticket')).not.toBeInTheDocument();
	expect(
		JSON.parse(
			window.localStorage.getItem(LINEAR_ISSUE_FILTERS_STORAGE_KEY) ?? '{}',
		).assignees,
	).toEqual(['me']);
});

test('offers everyone else by name, leaving the user to "Me"', async () => {
	renderList();
	await screen.findByText('Bob ticket');

	await userEvent.click(screen.getByRole('button', { name: 'Assignee' }));
	const listbox = await screen.findByRole('listbox');

	for (const name of ['Me', 'Unassigned', 'Bob']) {
		expect(within(listbox).getByRole('option', { name })).toBeInTheDocument();
	}
	expect(within(listbox).getAllByRole('option')).toHaveLength(3);
});

test('says the assignee facet is why the list is empty', async () => {
	window.localStorage.setItem(
		LINEAR_ISSUE_FILTERS_STORAGE_KEY,
		JSON.stringify({ assignees: ['unassigned'] }),
	);
	renderList();

	expect(
		await screen.findByText('No issues here match the assignee filter.'),
	).toBeInTheDocument();
	expect(screen.getByRole('button', { name: 'Clear filters' })).toBeVisible();
});
