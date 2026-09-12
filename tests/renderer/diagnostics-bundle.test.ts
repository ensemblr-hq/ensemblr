import { describe, expect, it } from 'vitest';

import { sanitizeDiagnosticsBundle } from '@/renderer/lib/diagnostics-bundle';
import type {
	SetupCheckSnapshot,
	SetupDiagnosticsSnapshot,
} from '@/shared/ipc/contracts/setup';

/** Builds a one-check snapshot whose log text is the string under test. */
function snapshotWithLogText(text: string): SetupDiagnosticsSnapshot {
	const check: SetupCheckSnapshot = {
		blocking: false,
		description: '',
		detail: '',
		group: 'core',
		id: 'git-executable',
		logs: [{ label: 'stdout', text, truncated: false }],
		remediationActions: [],
		status: 'success',
		title: 'Git',
		updatedAt: '2026-09-12T00:00:00.000Z',
	};

	return {
		blockedCount: 0,
		checks: [check],
		generatedAt: '2026-09-12T00:00:00.000Z',
		optionalCount: 0,
		requiredCount: 1,
		status: 'ready',
		successCount: 1,
		warningCount: 0,
	};
}

/** Reads back the sanitized log text of the single check in the snapshot. */
function sanitizedLogText(text: string): string {
	return sanitizeDiagnosticsBundle(snapshotWithLogText(text)).checks[0].logs[0]
		.text;
}

describe('sanitizeDiagnosticsBundle', () => {
	it.each([
		['/Users/philipp/code/app', '~/code/app'],
		['/home/philipp/code/app', '~/code/app'],
		['/root/.config/ensemblr', '~/.config/ensemblr'],
	])('collapses the home directory in %s', (input, expected) => {
		expect(sanitizedLogText(input)).toBe(expected);
	});

	it.each([
		'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
		'sk-proj-abcdefghijklmnopqrstuvwxyz',
		'AKIAIOSFODNN7EXAMPLE',
		'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K',
	])('redacts the provider secret %s', (secret) => {
		expect(sanitizedLogText(`token ${secret} seen`)).not.toContain(secret);
	});

	it('redacts a secret-named assignment', () => {
		expect(sanitizedLogText('OPENAI_KEY=sk-live-value')).not.toContain(
			'sk-live-value',
		);
	});

	it('masks an email address', () => {
		expect(sanitizedLogText('from philipp@example.com')).toBe('from ***@***');
	});

	it('leaves ordinary diagnostic text alone', () => {
		expect(sanitizedLogText('npm error code ENOENT')).toBe(
			'npm error code ENOENT',
		);
	});
});
