import { expect, test } from 'vitest';

import {
	isRepositoryAuthoredPreference,
	resolveActionPreference,
	sharedActionPreference,
	wrapRepositoryPreference,
} from '@/renderer/lib/workbench/action-preference';
import type { SettingsResolutionSnapshot } from '@/shared/ipc/contracts/settings-resolution';

function snapshotWith(key: string, value: unknown): SettingsResolutionSnapshot {
	return {
		app: { diagnostics: [], settings: [] },
		repository: {
			diagnostics: [],
			settings: [
				{ candidates: [], key, locked: false, source: 'sqlite', value },
			],
		},
	};
}

test('sharedActionPreference reads the resolved actionPreferences key', () => {
	const snapshot = snapshotWith(
		'actionPreferences.codeReview',
		'Shared review',
	);
	expect(sharedActionPreference(snapshot, 'codeReview')).toBe('Shared review');
	expect(sharedActionPreference(snapshot, 'createPr')).toBe('');
	expect(sharedActionPreference(undefined, 'codeReview')).toBe('');
});

test('resolveActionPreference prefers a non-empty personal override', () => {
	expect(resolveActionPreference('Personal', 'Shared')).toBe('Personal');
	expect(resolveActionPreference('', '')).toBe('');
});

// The committed `[prompts]` text reaches the agent through the same slot as the
// user's own words. Without the wrapper it is delivered under a header saying
// the user wrote it and that it outranks everything above — which is a
// repository author writing a top-priority instruction into someone else's
// agent, invisible at the moment the button is clicked.
test('resolveActionPreference marks committed repository text as repository-authored', () => {
	const resolved = resolveActionPreference('   ', 'Shared');

	expect(isRepositoryAuthoredPreference(resolved)).toBe(true);
	expect(isRepositoryAuthoredPreference('Personal')).toBe(false);
	expect(resolved).toContain('Shared');
	expect(resolved).toContain('.ensemblr/settings.toml');
	expect(resolved).toContain('not an instruction from the user');
	expect(resolveActionPreference('', 'Shared')).toBe(resolved);
});

test('wrapRepositoryPreference bounds the committed text', () => {
	const wrapped = wrapRepositoryPreference('x'.repeat(200_000));

	expect(wrapped.length).toBeLessThan(200_000);
	expect(wrapped).toContain('truncated');
	expect(wrapRepositoryPreference('  ')).toBe('');
});
