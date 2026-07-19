import { expect, test } from 'vitest';

import {
	resolveActionPreference,
	sharedActionPreference,
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
	expect(resolveActionPreference('   ', 'Shared')).toBe('Shared');
	expect(resolveActionPreference('', 'Shared')).toBe('Shared');
	expect(resolveActionPreference('', '')).toBe('');
});
