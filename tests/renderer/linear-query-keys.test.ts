import { expect, test } from 'vitest';
import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr/query-keys';

test('linearIssues: an organization filter is its own cache entry', () => {
	const everyOrganization = ensemblrQueryKeys.linearIssues({});
	const oneOrganization = ensemblrQueryKeys.linearIssues({
		accountId: 'account-2',
	});

	expect(oneOrganization).not.toEqual(everyOrganization);
	expect(oneOrganization.at(-1)).toBe('account-2');
	expect(everyOrganization.at(-1)).toBe('');
});

test('linearIssues: team and query still separate entries within one account', () => {
	const base = { accountId: 'account-1' };

	expect(ensemblrQueryKeys.linearIssues(base)).not.toEqual(
		ensemblrQueryKeys.linearIssues({ ...base, teamId: 'team-1' }),
	);
	expect(ensemblrQueryKeys.linearIssues(base)).not.toEqual(
		ensemblrQueryKeys.linearIssues({ ...base, query: 'oauth' }),
	);
});

test('linearIssuesAll: prefixes every filtered issue-list entry', () => {
	const prefix = ensemblrQueryKeys.linearIssuesAll();

	for (const filter of [
		{},
		{ accountId: 'account-2' },
		{ query: 'oauth', teamId: 'team-1' },
	]) {
		expect(
			ensemblrQueryKeys.linearIssues(filter).slice(0, prefix.length),
		).toEqual([...prefix]);
	}
});

test('linearIssue: a scoped read does not share an entry with an unscoped one', () => {
	const unscoped = ensemblrQueryKeys.linearIssue('issue-1');
	const scoped = ensemblrQueryKeys.linearIssue('issue-1', 'account-2');

	expect(scoped).not.toEqual(unscoped);
	expect(unscoped.at(-1)).toBe('');
	expect(scoped.at(-1)).toBe('account-2');
});

test('linearIssueAll: prefixes both scopings of one issue, and no other issue', () => {
	const prefix = ensemblrQueryKeys.linearIssueAll('issue-1');

	expect(
		ensemblrQueryKeys.linearIssue('issue-1').slice(0, prefix.length),
	).toEqual([...prefix]);
	expect(
		ensemblrQueryKeys
			.linearIssue('issue-1', 'account-2')
			.slice(0, prefix.length),
	).toEqual([...prefix]);
	expect(
		ensemblrQueryKeys
			.linearIssue('issue-2', 'account-2')
			.slice(0, prefix.length),
	).not.toEqual([...prefix]);
});
