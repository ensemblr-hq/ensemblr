import { describe, expect, test } from 'vitest';

import {
	readSetupState,
	type WorkspaceSetupState,
	withSetupState,
} from '../../../src/shared/scripts/setup-state';

const STATE: WorkspaceSetupState = {
	command: 'npm install',
	completedAt: '2026-07-11T00:00:00.000Z',
	fingerprint: 'abc123',
};

describe('readSetupState', () => {
	test('reads a well-formed setup record', () => {
		expect(readSetupState({ setup: STATE })).toEqual(STATE);
	});

	test('returns null when no setup key is present', () => {
		expect(readSetupState({})).toBeNull();
		expect(readSetupState({ other: 1 })).toBeNull();
	});

	test('returns null for malformed or partial records', () => {
		expect(readSetupState({ setup: null })).toBeNull();
		expect(readSetupState({ setup: 'npm install' })).toBeNull();
		expect(readSetupState({ setup: ['npm install'] })).toBeNull();
		expect(readSetupState({ setup: { command: 'npm install' } })).toBeNull();
		expect(
			readSetupState({
				setup: { command: 'npm install', completedAt: 5, fingerprint: 'x' },
			}),
		).toBeNull();
	});
});

describe('withSetupState', () => {
	test('merges the setup slice without mutating the input', () => {
		const metadata = { linkedIssue: { id: 'THE-1' }, port: 3000 };
		const next = withSetupState(metadata, STATE);

		expect(next).toEqual({
			linkedIssue: { id: 'THE-1' },
			port: 3000,
			setup: STATE,
		});
		expect(metadata).not.toHaveProperty('setup');
	});

	test('replaces an existing setup slice', () => {
		const older = { ...STATE, fingerprint: 'old' };
		const next = withSetupState({ setup: older }, STATE);

		expect(readSetupState(next)).toEqual(STATE);
	});
});
