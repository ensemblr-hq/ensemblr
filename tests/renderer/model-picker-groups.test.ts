/// <reference types="bun" />

import { describe, expect, test } from 'bun:test';

import { buildModelGroups } from '../../src/renderer/components/workbench-shell/conversation-panel/composer/model-picker';
import type { ComposerModelOption } from '../../src/renderer/types/workbench';

function model(id: string, provider: string): ComposerModelOption {
	return { displayName: id, id, isDefault: false, provider };
}

const OPTIONS: readonly ComposerModelOption[] = [
	model('anthropic/haiku', 'anthropic'),
	model('anthropic/sonnet', 'anthropic'),
	model('google/gemini', 'google'),
];

describe('buildModelGroups', () => {
	test('pins favourites first in starred order and removes them from provider groups', () => {
		const groups = buildModelGroups(OPTIONS, [
			'google/gemini',
			'anthropic/haiku',
		]);

		expect(groups[0]?.providerLabel).toBe('Favourites');
		expect(groups[0]?.models.map((m) => m.id)).toEqual([
			'google/gemini',
			'anthropic/haiku',
		]);
		// Remaining provider groups exclude the favourited ids.
		const rest = groups.slice(1).flatMap((g) => g.models.map((m) => m.id));
		expect(rest).toEqual(['anthropic/sonnet']);
	});

	test('favourites take the leading shortcut slots (flattened order)', () => {
		const groups = buildModelGroups(OPTIONS, ['google/gemini']);
		const ordered = groups.flatMap((g) => g.models.map((m) => m.id));
		expect(ordered[0]).toBe('google/gemini');
	});

	test('omits the Favourites group when there are no favourites', () => {
		const groups = buildModelGroups(OPTIONS, []);
		expect(groups.some((g) => g.providerLabel === 'Favourites')).toBe(false);
		expect(groups.flatMap((g) => g.models)).toHaveLength(OPTIONS.length);
	});

	test('ignores stale favourite ids that are no longer available', () => {
		const groups = buildModelGroups(OPTIONS, ['removed/model']);
		expect(groups.some((g) => g.providerLabel === 'Favourites')).toBe(false);
		expect(groups.flatMap((g) => g.models)).toHaveLength(OPTIONS.length);
	});
});
