import { expect, test } from 'bun:test';

import { createLinearIssueFixture } from '../fixtures/linear';
import {
	buildCreateIssueRequest,
	buildUpdateIssueRequest,
	createIssueEditorFields,
	UNSET_FIELD,
	validateIssueEditorFields,
} from '../../src/renderer/lib/linear';

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
		error: 'A title is required.',
		ok: false,
	});
	expect(
		validateIssueEditorFields({ ...fields, title: 'X' }, 'create'),
	).toEqual({ error: 'Choose a team for the new issue.', ok: false });
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

	expect(buildUpdateIssueRequest(issue, fields)).toEqual({
		id: 'issue-1',
		input: {
			priority: 1,
			stateId: 'state-2',
			title: 'Renamed issue',
		},
	});
});

test('buildUpdateIssueRequest: tracks label changes as a full label set', () => {
	const issue = createLinearIssueFixture();
	const fields = {
		...createIssueEditorFields(issue),
		labelIds: ['label-1', 'label-2'],
	};

	expect(buildUpdateIssueRequest(issue, fields)).toEqual({
		id: 'issue-1',
		input: { labelIds: ['label-1', 'label-2'] },
	});
});
