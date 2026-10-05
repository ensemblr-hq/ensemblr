import { describe, expect, test } from 'vitest';

import {
	createLinearAssigneeMatcher,
	isLinearAssigneeSelection,
	LINEAR_ASSIGNEE_ME,
	LINEAR_ASSIGNEE_UNASSIGNED,
	listLinearAssigneeOptions,
	toggleLinearAssignee,
} from '@/renderer/lib/linear';
import type { LinearResourceWire } from '@/shared/ipc/contracts/linear';
import { createLinearIssueFixture } from '../fixtures/linear';

const VIEWERS = ['viewer-a', 'viewer-b'];

const mine = createLinearIssueFixture({
	assigneeId: 'viewer-a',
	assigneeName: 'Me in org A',
	id: 'mine',
});
const mineElsewhere = createLinearIssueFixture({
	accountId: 'account-2',
	assigneeId: 'viewer-b',
	assigneeName: 'Me in org B',
	id: 'mine-elsewhere',
});
const unassigned = createLinearIssueFixture({
	assigneeId: null,
	assigneeName: null,
	id: 'unassigned',
});
const bobs = createLinearIssueFixture({
	assigneeId: 'bob',
	assigneeName: 'Bob',
	id: 'bobs',
});
const ISSUES = [mine, mineElsewhere, unassigned, bobs];

/** Ids of the issues a selection keeps. */
function kept(selection: string[]): string[] {
	const matches = createLinearAssigneeMatcher(selection, VIEWERS);
	return ISSUES.filter(matches).map((issue) => issue.id);
}

/** A cached Linear member, as the metadata read returns one. */
function user(id: string, name: string): LinearResourceWire {
	return {
		accountId: 'account-1',
		color: null,
		id,
		key: null,
		kind: 'user',
		name,
		organizationName: 'Example Org',
		teamId: null,
		type: null,
	};
}

describe('createLinearAssigneeMatcher', () => {
	test('keeps every issue when nothing is selected', () => {
		expect(kept([])).toEqual(['mine', 'mine-elsewhere', 'unassigned', 'bobs']);
	});

	// One person is a different Linear user in each organization they belong to,
	// so "me" has to mean every connected account's own user.
	test('reads "me" as any connected account', () => {
		expect(kept([LINEAR_ASSIGNEE_ME])).toEqual(['mine', 'mine-elsewhere']);
	});

	test('keeps only issues nobody holds under "unassigned"', () => {
		expect(kept([LINEAR_ASSIGNEE_UNASSIGNED])).toEqual(['unassigned']);
	});

	test('combines entries as a union', () => {
		expect(kept([LINEAR_ASSIGNEE_ME, LINEAR_ASSIGNEE_UNASSIGNED])).toEqual([
			'mine',
			'mine-elsewhere',
			'unassigned',
		]);
	});

	test('narrows to a named person', () => {
		expect(kept(['bob'])).toEqual(['bobs']);
	});

	test('matches nothing under "me" before any account is known', () => {
		const matches = createLinearAssigneeMatcher([LINEAR_ASSIGNEE_ME], []);

		expect(ISSUES.filter(matches)).toEqual([]);
	});
});

describe('listLinearAssigneeOptions', () => {
	test('offers each assignee once, leaving out the user themself', () => {
		const options = listLinearAssigneeOptions({
			issues: [...ISSUES, createLinearIssueFixture({ assigneeId: 'bob' })],
			selection: [],
			users: undefined,
			viewerIds: VIEWERS,
		});

		expect(options.map((option) => option.id)).toEqual(['bob']);
	});

	// A selected person whose issues have all closed would otherwise vanish from
	// the facet while still narrowing the list, with no row left to uncheck.
	test('keeps a selected person no loaded issue names, named from the members', () => {
		const options = listLinearAssigneeOptions({
			issues: [bobs],
			selection: ['carol', LINEAR_ASSIGNEE_ME],
			users: [user('carol', 'Carol')],
			viewerIds: VIEWERS,
		});

		expect(options).toEqual([
			{ id: 'bob', name: 'Bob', organizationName: 'Example Org' },
			{ id: 'carol', name: 'Carol', organizationName: 'Example Org' },
		]);
	});

	test('orders by name and puts an id nothing names last', () => {
		const options = listLinearAssigneeOptions({
			issues: [
				createLinearIssueFixture({ assigneeId: 'zed', assigneeName: 'Zed' }),
				bobs,
			],
			selection: ['ghost'],
			users: undefined,
			viewerIds: VIEWERS,
		});

		expect(options.map((option) => [option.id, option.name])).toEqual([
			['bob', 'Bob'],
			['zed', 'Zed'],
			['ghost', null],
		]);
	});
});

describe('toggleLinearAssignee', () => {
	test('adds an entry and takes it back out', () => {
		const added = toggleLinearAssignee([LINEAR_ASSIGNEE_ME], 'bob');

		expect(added).toEqual([LINEAR_ASSIGNEE_ME, 'bob']);
		expect(toggleLinearAssignee(added, LINEAR_ASSIGNEE_ME)).toEqual(['bob']);
	});
});

describe('isLinearAssigneeSelection', () => {
	test.each([
		[[], true],
		[['me', 'bob'], true],
		[['me', 7], false],
		['me', false],
		[null, false],
	])('reads %j as a selection: %s', (value, expected) => {
		expect(isLinearAssigneeSelection(value)).toBe(expected);
	});
});
