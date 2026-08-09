import { describe, expect, test } from 'vitest';

import {
	failureDetail,
	failureText,
} from '../../src/renderer/lib/failure-text';
import { i18n } from '../../src/renderer/lib/i18n';

const t = i18n.t;

describe('failureText', () => {
	test('renders the authored headline for a code the table carries', () => {
		expect(
			failureText(t, {
				code: 'workspace-not-found',
				message: 'A workspace id is required to rename a workspace.',
			}),
		).toBe('That workspace no longer exists.');
	});

	test("falls back to main's message for a code the table does not carry", () => {
		expect(
			failureText(t, {
				code: 'pi-executable-not-found',
				message: 'Pi was not found in the shell-derived PATH.',
			}),
		).toBe('Pi was not found in the shell-derived PATH.');
	});

	test('returns null when there is no failure', () => {
		expect(failureText(t, null)).toBeNull();
		expect(failureText(t, undefined)).toBeNull();
	});
});

describe('failureDetail', () => {
	test('keeps a message carrying a path the headline cannot name', () => {
		const message =
			'A file or directory already exists at /Users/me/repos/app.';

		expect(failureDetail(t, { code: 'destination-exists', message })).toBe(
			message,
		);
	});

	test('keeps a message carrying a quoted branch name', () => {
		const message =
			'Branch "feature/login" was not found locally or on origin, so the workspace could not take it over.';

		expect(failureDetail(t, { code: 'branch-not-found', message })).toBe(
			message,
		);
	});

	test('drops a message that only restates the headline in other words', () => {
		expect(
			failureDetail(t, {
				code: 'repository-id-required',
				message: 'A repository id is required to archive a repository.',
			}),
		).toBeNull();
	});

	test('drops a message identical to the headline', () => {
		expect(
			failureDetail(t, {
				code: 'workspace-not-found',
				message: 'That workspace no longer exists.',
			}),
		).toBeNull();
	});

	test('drops an empty message', () => {
		expect(
			failureDetail(t, { code: 'workspace-not-found', message: '   ' }),
		).toBeNull();
	});

	test('drops a message for a code the table does not carry', () => {
		expect(
			failureDetail(t, {
				code: 'pi-executable-not-found',
				message: 'Pi was not found in /usr/local/bin.',
			}),
		).toBeNull();
	});
});
