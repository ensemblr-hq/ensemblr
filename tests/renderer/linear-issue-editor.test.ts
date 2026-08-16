import { expect, test } from 'vitest';
import {
	buildCreateIssueRequest,
	buildTeamChangeFields,
	buildUpdateIssueRequest,
	createIssueEditorFields,
	formatIssueDueDate,
	parseIssueDueDate,
	UNSET_FIELD,
	validateIssueEditorFields,
} from '../../src/renderer/lib/linear';
import { createLinearIssueFixture } from '../fixtures/linear';

test('createIssueEditorFields: empty for creation, seeded for editing', () => {
	const empty = createIssueEditorFields();
	expect(empty.title).toBe('');
	expect(empty.teamId).toBe('');
	expect(empty.stateId).toBe(UNSET_FIELD);
	expect(empty.labelIds).toEqual([]);

	const seeded = createIssueEditorFields(createLinearIssueFixture());
	expect(seeded.title).toBe('Linear OAuth PKCE and Token Lifecycle');
	expect(seeded.teamId).toBe('team-1');
	expect(seeded.stateId).toBe('state-1');
	expect(seeded.priority).toBe('2');
	expect(seeded.labelIds).toEqual(['label-1']);
});

test('validateIssueEditorFields: requires a title always and a team on create', () => {
	const fields = createIssueEditorFields();

	expect(validateIssueEditorFields(fields, 'create')).toEqual({
		code: 'title-required',
		ok: false,
	});
	expect(
		validateIssueEditorFields({ ...fields, title: 'X' }, 'create'),
	).toEqual({ code: 'team-required', ok: false });
	expect(
		validateIssueEditorFields(
			{ ...fields, teamId: 'team-1', title: 'X' },
			'create',
		),
	).toEqual({ ok: true });
	expect(validateIssueEditorFields({ ...fields, title: 'X' }, 'edit')).toEqual({
		ok: true,
	});
});

test('buildCreateIssueRequest: includes only set fields', () => {
	const minimal = buildCreateIssueRequest({
		...createIssueEditorFields(),
		teamId: 'team-1',
		title: '  New issue  ',
	});

	expect(minimal).toEqual({ teamId: 'team-1', title: 'New issue' });

	const full = buildCreateIssueRequest({
		assigneeId: 'user-1',
		cycleId: 'cycle-1',
		description: 'Body',
		dueDate: '2026-07-01',
		labelIds: ['label-1'],
		priority: '2',
		projectId: 'project-1',
		stateId: 'state-1',
		teamId: 'team-1',
		title: 'Full issue',
	});

	expect(full).toEqual({
		assigneeId: 'user-1',
		cycleId: 'cycle-1',
		description: 'Body',
		dueDate: '2026-07-01',
		labelIds: ['label-1'],
		priority: 2,
		projectId: 'project-1',
		stateId: 'state-1',
		teamId: 'team-1',
		title: 'Full issue',
	});
});

test('buildUpdateIssueRequest: returns null when nothing changed', () => {
	const issue = createLinearIssueFixture();

	expect(
		buildUpdateIssueRequest(issue, createIssueEditorFields(issue)),
	).toBeNull();
});

test('buildUpdateIssueRequest: contains only changed fields', () => {
	const issue = createLinearIssueFixture();
	const fields = {
		...createIssueEditorFields(issue),
		priority: '1',
		stateId: 'state-2',
		title: 'Renamed issue',
	};

	// The account rides along so the update reaches the right organization even
	// when the local cache has been cleared out from under it.
	expect(buildUpdateIssueRequest(issue, fields)).toEqual({
		accountId: 'account-1',
		id: 'issue-1',
		input: {
			priority: 1,
			stateId: 'state-2',
			title: 'Renamed issue',
		},
	});
});

test('parseIssueDueDate: reads the stored date as a local calendar day', () => {
	const parsed = parseIssueDueDate('2026-08-16');

	expect(parsed?.getFullYear()).toBe(2026);
	expect(parsed?.getMonth()).toBe(7);
	expect(parsed?.getDate()).toBe(16);
});

test('parseIssueDueDate: rejects an empty or malformed value', () => {
	expect(parseIssueDueDate('')).toBeUndefined();
	expect(parseIssueDueDate('16/08/2026')).toBeUndefined();
	expect(parseIssueDueDate('2026-13-40')).toBeUndefined();
});

test('formatIssueDueDate: round-trips a picked day back to Linear', () => {
	const picked = new Date(2026, 0, 5, 12, 0, 0);

	expect(formatIssueDueDate(picked)).toBe('2026-01-05');
	expect(formatIssueDueDate(parseIssueDueDate('2026-08-16') as Date)).toBe(
		'2026-08-16',
	);
});

test('buildUpdateIssueRequest: tracks label changes as a full label set', () => {
	const issue = createLinearIssueFixture();
	const fields = {
		...createIssueEditorFields(issue),
		labelIds: ['label-1', 'label-2'],
	};

	expect(buildUpdateIssueRequest(issue, fields)).toEqual({
		accountId: 'account-1',
		id: 'issue-1',
		input: { labelIds: ['label-1', 'label-2'] },
	});
});

test('buildUpdateIssueRequest: clears a due date as an explicit null', () => {
	const issue = createLinearIssueFixture({ dueDate: '2026-07-01' });
	const fields = { ...createIssueEditorFields(issue), dueDate: '' };

	expect(buildUpdateIssueRequest(issue, fields)).toEqual({
		accountId: 'account-1',
		id: 'issue-1',
		input: { dueDate: null },
	});
});

test('buildUpdateIssueRequest: sends a newly picked due date as its date string', () => {
	const issue = createLinearIssueFixture();
	const fields = { ...createIssueEditorFields(issue), dueDate: '2026-09-30' };

	expect(buildUpdateIssueRequest(issue, fields)).toEqual({
		accountId: 'account-1',
		id: 'issue-1',
		input: { dueDate: '2026-09-30' },
	});
});

test('buildUpdateIssueRequest: leaves an untouched due date out of the payload', () => {
	const issue = createLinearIssueFixture({ dueDate: '2026-07-01' });
	const fields = {
		...createIssueEditorFields(issue),
		title: 'Renamed issue',
	};

	expect(buildUpdateIssueRequest(issue, fields)).toEqual({
		accountId: 'account-1',
		id: 'issue-1',
		input: { title: 'Renamed issue' },
	});
});

test('buildTeamChangeFields: clears every account- and team-scoped field', () => {
	const filled = {
		...createIssueEditorFields(),
		assigneeId: 'user-1',
		cycleId: 'cycle-1',
		labelIds: ['label-1'],
		projectId: 'project-1',
		stateId: 'state-1',
		teamId: 'team-1',
		title: 'Kept',
	};

	const switched = { ...filled, ...buildTeamChangeFields('team-2') };

	expect(switched.teamId).toBe('team-2');
	expect(switched.assigneeId).toBe(UNSET_FIELD);
	expect(switched.projectId).toBe(UNSET_FIELD);
	expect(switched.stateId).toBe(UNSET_FIELD);
	expect(switched.cycleId).toBe(UNSET_FIELD);
	expect(switched.labelIds).toEqual([]);
	expect(switched.title).toBe('Kept');
});

test('buildTeamChangeFields: leaves the previous fields untouched', () => {
	const filled = {
		...createIssueEditorFields(),
		assigneeId: 'user-1',
		projectId: 'project-1',
	};

	buildTeamChangeFields('team-2');

	expect(filled.assigneeId).toBe('user-1');
	expect(filled.projectId).toBe('project-1');
});
