// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test } from 'vitest';

import { ALL_TEAMS, DEFAULT_LINEAR_ISSUE_FILTERS } from '@/renderer/lib/linear';
import {
	LINEAR_ISSUE_FILTERS_STORAGE_KEY,
	useLinearIssueFilters,
} from '@/renderer/state/linear';
import { installLocalStorage } from './support/dom';

let store: ReturnType<typeof createStore>;

beforeEach(() => {
	installLocalStorage();
	store = createStore();
});

/** Mounts the filter hook against the given store, defaulting to the current one. */
function render(against: ReturnType<typeof createStore> = store) {
	return renderHook(useLinearIssueFilters, {
		wrapper: ({ children }: { children: ReactNode }) => (
			<Provider store={against}>{children}</Provider>
		),
	});
}

/** Reads the raw JSON the atom wrote, as a restarted app would find it. */
function stored(): string | null {
	return window.localStorage.getItem(LINEAR_ISSUE_FILTERS_STORAGE_KEY);
}

describe('useLinearIssueFilters', () => {
	test('starts unsearched and unnarrowed', () => {
		const { result } = render();

		expect(result.current.filters).toEqual(DEFAULT_LINEAR_ISSUE_FILTERS);
	});

	test('sets each facet independently', () => {
		const { result } = render();

		act(() => result.current.setAccountId('account-1'));
		act(() => result.current.setTeamId('team-1'));
		act(() => result.current.setQuery('oauth'));

		expect(result.current.filters).toEqual({
			accountId: 'account-1',
			query: 'oauth',
			teamId: 'team-1',
		});
	});

	// A team belongs to exactly one account, so keeping it across an account
	// switch would narrow the list to nothing.
	test('clears the team when the account changes', () => {
		const { result } = render();

		act(() => result.current.setTeamId('team-1'));
		act(() => result.current.setAccountId('account-2'));

		expect(result.current.filters.teamId).toBe(ALL_TEAMS);
		expect(result.current.filters.accountId).toBe('account-2');
	});

	test('clear returns every facet to its default', () => {
		const { result } = render();

		act(() => result.current.setAccountId('account-1'));
		act(() => result.current.setQuery('oauth'));
		act(() => result.current.clear());

		expect(result.current.filters).toEqual(DEFAULT_LINEAR_ISSUE_FILTERS);
	});

	// The list unmounts whenever an issue is opened, which is the case the whole
	// feature exists for. One store outlives the unmount, so this covers the
	// navigate-away round trip without saying anything about storage.
	test('survives leaving the list and coming back', () => {
		const first = render();

		act(() => first.result.current.setQuery('oauth'));
		act(() => first.result.current.setAccountId('account-1'));
		first.unmount();

		const second = render();

		expect(second.result.current.filters).toEqual({
			accountId: 'account-1',
			query: 'oauth',
			teamId: ALL_TEAMS,
		});
	});

	// A fresh store is what a cold start actually looks like: only local storage
	// carries the value across, so this is the test that fails if the key, the
	// serialization, or `getOnInit` breaks.
	test('survives an app restart', () => {
		const first = render();

		act(() => first.result.current.setAccountId('account-1'));
		act(() => first.result.current.setTeamId('team-1'));
		act(() => first.result.current.setQuery('oauth'));
		first.unmount();

		expect(stored()).not.toBeNull();

		const restarted = render(createStore());

		expect(restarted.result.current.filters).toEqual({
			accountId: 'account-1',
			query: 'oauth',
			teamId: 'team-1',
		});
	});

	test('clear is what a restart reads back, not just what the store holds', () => {
		const first = render();

		act(() => first.result.current.setQuery('oauth'));
		act(() => first.result.current.clear());
		first.unmount();

		const restarted = render(createStore());

		expect(restarted.result.current.filters).toEqual(
			DEFAULT_LINEAR_ISSUE_FILTERS,
		);
	});

	// `getOnInit` puts the stored value into the first render, so anything that
	// does not decode to the expected shape has to degrade rather than throw
	// where the filters are read.
	describe('rejects a stored value of the wrong shape', () => {
		const cases: Record<string, string> = {
			'a bare null': 'null',
			'a number': '42',
			'a string': '"oauth"',
			'an array': '["account-1"]',
			'a field of the wrong type': '{"accountId":7,"query":"","teamId":"all"}',
			'malformed json': '{not json',
		};

		for (const [name, raw] of Object.entries(cases)) {
			test(name, () => {
				window.localStorage.setItem(LINEAR_ISSUE_FILTERS_STORAGE_KEY, raw);

				const { result } = render(createStore());

				expect(result.current.filters).toEqual(DEFAULT_LINEAR_ISSUE_FILTERS);
			});
		}
	});

	// A value written before a field existed is the ordinary version of the case
	// above: keep what it does carry, default what it does not.
	test('fills a missing field from the defaults', () => {
		window.localStorage.setItem(
			LINEAR_ISSUE_FILTERS_STORAGE_KEY,
			JSON.stringify({ query: 'oauth' }),
		);

		const { result } = render(createStore());

		expect(result.current.filters).toEqual({
			accountId: DEFAULT_LINEAR_ISSUE_FILTERS.accountId,
			query: 'oauth',
			teamId: DEFAULT_LINEAR_ISSUE_FILTERS.teamId,
		});
	});
});
