import { describe, expect, test } from 'vitest';

import { parseIssues } from '../../src/main/repository/repository-sources-service.ts';

describe('parseIssues assignees', () => {
	test('flattens assignee logins so the board can filter on them', () => {
		const stdout = JSON.stringify([
			{
				assignees: [{ login: 'octocat' }, { login: 'hubot' }],
				number: 42,
				state: 'OPEN',
				title: 'Paste loses the file',
			},
		]);

		expect(parseIssues(stdout)?.[0]?.assigneeLogins).toEqual([
			'octocat',
			'hubot',
		]);
	});

	test('reports an unassigned issue as an empty list, not a missing field', () => {
		const stdout = JSON.stringify([
			{ assignees: [], number: 41, title: 'Nobody on it' },
			{ number: 40, title: 'No assignees key at all' },
		]);

		const rows = parseIssues(stdout);

		expect(rows?.[0]?.assigneeLogins).toEqual([]);
		expect(rows?.[1]?.assigneeLogins).toEqual([]);
	});

	test('skips entries that carry no usable login', () => {
		const stdout = JSON.stringify([
			{
				assignees: [{ login: '' }, { login: 7 }, null, { login: 'octocat' }],
				number: 39,
				title: 'Mixed shapes',
			},
		]);

		expect(parseIssues(stdout)?.[0]?.assigneeLogins).toEqual(['octocat']);
	});

	test('still flattens label names alongside assignees', () => {
		const stdout = JSON.stringify([
			{
				assignees: [{ login: 'octocat' }],
				labels: [{ name: 'bug' }, { name: 'p1' }],
				number: 38,
				title: 'Both lists',
			},
		]);

		const row = parseIssues(stdout)?.[0];

		expect(row?.labels).toEqual(['bug', 'p1']);
		expect(row?.assigneeLogins).toEqual(['octocat']);
	});
});
