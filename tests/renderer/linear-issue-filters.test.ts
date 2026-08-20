import { describe, expect, test } from 'vitest';

import {
	ALL_ACCOUNTS,
	ALL_TEAMS,
	DEFAULT_LINEAR_ISSUE_FILTERS,
	hasLinearIssueFilters,
	type LinearIssueFilters,
	resolveLinearIssueFilters,
} from '@/renderer/lib/linear';
import {
	createLinearAccountFixture,
	createLinearTeamFixture,
} from '../fixtures/linear';

const ACCOUNTS = [
	createLinearAccountFixture({ id: 'account-1' }),
	createLinearAccountFixture({ id: 'account-2' }),
];

const TEAMS = [
	createLinearTeamFixture({ accountId: 'account-1', id: 'team-1' }),
	createLinearTeamFixture({ accountId: 'account-1', id: 'team-2' }),
	createLinearTeamFixture({ accountId: 'account-2', id: 'team-3' }),
];

function filters(overrides: Partial<LinearIssueFilters>): LinearIssueFilters {
	return { ...DEFAULT_LINEAR_ISSUE_FILTERS, ...overrides };
}

describe('resolveLinearIssueFilters', () => {
	test('keeps the sentinels and every team when nothing is narrowed', () => {
		const resolved = resolveLinearIssueFilters({
			accounts: ACCOUNTS,
			filters: DEFAULT_LINEAR_ISSUE_FILTERS,
			teams: TEAMS,
		});

		expect(resolved).toEqual({
			accountId: ALL_ACCOUNTS,
			teamId: ALL_TEAMS,
			teams: TEAMS,
		});
	});

	test('narrows the team options to the selected account', () => {
		const resolved = resolveLinearIssueFilters({
			accounts: ACCOUNTS,
			filters: filters({ accountId: 'account-1', teamId: 'team-2' }),
			teams: TEAMS,
		});

		expect(resolved.accountId).toBe('account-1');
		expect(resolved.teamId).toBe('team-2');
		expect(resolved.teams.map((option) => option.id)).toEqual([
			'team-1',
			'team-2',
		]);
	});

	// A remembered filter outlives the account it names, and a phantom id would
	// otherwise empty the list with nothing on screen to explain it.
	test('falls back when the remembered account is gone', () => {
		const resolved = resolveLinearIssueFilters({
			accounts: ACCOUNTS,
			filters: filters({ accountId: 'account-9', teamId: 'team-1' }),
			teams: TEAMS,
		});

		expect(resolved.accountId).toBe(ALL_ACCOUNTS);
		expect(resolved.teamId).toBe('team-1');
	});

	test('falls back when the remembered team is gone', () => {
		const resolved = resolveLinearIssueFilters({
			accounts: ACCOUNTS,
			filters: filters({ accountId: 'account-1', teamId: 'team-9' }),
			teams: TEAMS,
		});

		expect(resolved.teamId).toBe(ALL_TEAMS);
	});

	test('falls back when the remembered team belongs to another account', () => {
		const resolved = resolveLinearIssueFilters({
			accounts: ACCOUNTS,
			filters: filters({ accountId: 'account-1', teamId: 'team-3' }),
			teams: TEAMS,
		});

		expect(resolved.teamId).toBe(ALL_TEAMS);
	});

	test('falls back when the selected account has no teams at all', () => {
		const resolved = resolveLinearIssueFilters({
			accounts: ACCOUNTS,
			filters: filters({ accountId: 'account-2', teamId: 'team-1' }),
			teams: [
				createLinearTeamFixture({ accountId: 'account-1', id: 'team-1' }),
			],
		});

		expect(resolved.teams).toEqual([]);
		expect(resolved.teamId).toBe(ALL_TEAMS);
	});

	// `undefined` is the query still in flight, so dropping the filter there
	// would lose it on every reload.
	test('holds the filters while the accounts and teams are still loading', () => {
		const resolved = resolveLinearIssueFilters({
			accounts: undefined,
			filters: filters({ accountId: 'account-1', teamId: 'team-1' }),
			teams: undefined,
		});

		expect(resolved.accountId).toBe('account-1');
		expect(resolved.teamId).toBe('team-1');
		expect(resolved.teams).toEqual([]);
	});

	test('holds the team while only the metadata is still loading', () => {
		const resolved = resolveLinearIssueFilters({
			accounts: ACCOUNTS,
			filters: filters({ accountId: 'account-1', teamId: 'team-1' }),
			teams: undefined,
		});

		expect(resolved.accountId).toBe('account-1');
		expect(resolved.teamId).toBe('team-1');
	});

	// An answered query that returned nothing is not the same as an unanswered
	// one: the team picker hides itself when there are no options, so a held id
	// would narrow the list with no control left to clear it.
	test('drops a stored team once the metadata answers with none', () => {
		const resolved = resolveLinearIssueFilters({
			accounts: ACCOUNTS,
			filters: filters({ accountId: 'account-1', teamId: 'team-1' }),
			teams: [],
		});

		expect(resolved.teamId).toBe(ALL_TEAMS);
	});

	test('drops a stored account once the connection answers with none', () => {
		const resolved = resolveLinearIssueFilters({
			accounts: [],
			filters: filters({ accountId: 'account-1' }),
			teams: [],
		});

		expect(resolved.accountId).toBe(ALL_ACCOUNTS);
	});
});

describe('hasLinearIssueFilters', () => {
	test('is false when nothing is narrowed', () => {
		expect(hasLinearIssueFilters(DEFAULT_LINEAR_ISSUE_FILTERS)).toBe(false);
	});

	test.each([
		['search', { query: 'oauth' }],
		['account', { accountId: 'account-1' }],
		['team', { teamId: 'team-1' }],
	])('is true when only the %s is set', (_facet, overrides) => {
		expect(hasLinearIssueFilters(filters(overrides))).toBe(true);
	});
});
