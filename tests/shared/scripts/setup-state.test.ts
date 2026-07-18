import { describe, expect, test } from 'vitest';

import {
	parseSetupState,
	type WorkspaceSetupState,
} from '../../../src/shared/scripts/setup-state';

const STATE: WorkspaceSetupState = {
	command: 'npm install',
	completedAt: '2026-07-11T00:00:00.000Z',
	fingerprint: 'abc123',
};

describe('parseSetupState', () => {
	test('parses a well-formed setup record', () => {
		expect(parseSetupState({ ...STATE })).toEqual(STATE);
	});

	test('returns null for non-object values', () => {
		expect(parseSetupState(null)).toBeNull();
		expect(parseSetupState('npm install')).toBeNull();
		expect(parseSetupState(['npm install'])).toBeNull();
	});

	test('returns null for malformed or partial records', () => {
		expect(parseSetupState({ command: 'npm install' })).toBeNull();
		expect(
			parseSetupState({
				command: 'npm install',
				completedAt: 5,
				fingerprint: 'x',
			}),
		).toBeNull();
	});

	test('ignores extra keys', () => {
		expect(parseSetupState({ ...STATE, extra: true })).toEqual(STATE);
	});
});
