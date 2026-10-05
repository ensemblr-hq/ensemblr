// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
import { afterEach, expect, test, vi } from 'vitest';

import { LinearIssueList } from '@/renderer/components/linear/issue-list';
import type {
	GetLinearMetadataResult,
	LinearAccountFailure,
	ListLinearIssuesRequest,
	ListLinearIssuesResult,
} from '@/shared/ipc/contracts/linear';
import {
	createLinearAccountFixture,
	createLinearConnectionFixture,
	createLinearFailureFixture,
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

const UNREACHABLE: LinearAccountFailure[] = [
	{
		accountId: 'account-1',
		failure: createLinearFailureFixture(),
		organizationName: 'The Swiss Cheese',
	},
	{
		accountId: 'account-2',
		failure: createLinearFailureFixture(),
		organizationName: 'Almost Always',
	},
];

/**
 * A cached list answer carrying the given account failures.
 * @param accountFailures - Accounts the read could not reach
 * @returns The list answer
 */
function cachedAnswer(
	accountFailures: LinearAccountFailure[],
): ListLinearIssuesResult {
	return {
		accountFailures,
		issues: [createLinearIssueFixture({ title: 'Cached ticket' })],
		source: 'cache',
		status: 'ok',
	};
}

/**
 * Installs a bridge answering the list with `first` until a refresh asks for
 * Linear directly, then with `refreshed`.
 * @param first - The cache-first answer
 * @param refreshed - The answer a refresh gets
 * @returns Every list request the surface made
 */
function installBridge(
	first: ListLinearIssuesResult,
	refreshed: ListLinearIssuesResult,
): ListLinearIssuesRequest[] {
	const requests: ListLinearIssuesRequest[] = [];

	installLocalStorage();
	installEnsemblrApi({
		linearConnectionStatus: async () =>
			createLinearConnectionFixture({
				accounts: [createLinearAccountFixture()],
			}),
		linearListIssues: async (request: ListLinearIssuesRequest) => {
			requests.push(request);
			return request.refresh ? refreshed : first;
		},
		linearMetadata: async () => METADATA,
	});

	return requests;
}

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

test('names every unreachable organization once and clears after a retry', async () => {
	const requests = installBridge(cachedAnswer(UNREACHABLE), cachedAnswer([]));
	renderList();

	expect(
		await screen.findByText(
			'Could not reach Linear for The Swiss Cheese and Almost Always. Showing cached data where available.',
		),
	).toBeInTheDocument();
	expect(screen.getByText('Cached ticket')).toBeInTheDocument();

	await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

	await vi.waitFor(() =>
		expect(
			screen.queryByText(/Could not reach Linear/),
		).not.toBeInTheDocument(),
	);
	expect(requests.some((request) => request.refresh === true)).toBe(true);
});

test('offers no retry when only a reconnect can fix the organization', async () => {
	installBridge(
		cachedAnswer([
			{
				accountId: 'account-1',
				failure: createLinearFailureFixture({ code: 'reconnect-required' }),
				organizationName: 'The Swiss Cheese',
			},
		]),
		cachedAnswer([]),
	);
	renderList();

	expect(
		await screen.findByText(
			'The Linear connection for The Swiss Cheese expired. Reconnect from integration settings.',
		),
	).toBeInTheDocument();
	expect(
		screen.queryByRole('button', { name: 'Try again' }),
	).not.toBeInTheDocument();
});
