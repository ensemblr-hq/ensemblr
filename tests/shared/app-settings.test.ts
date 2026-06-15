/// <reference types="bun" />

import { describe, expect, test } from 'bun:test';

import {
	appSettingsPatchSchema,
	DEFAULT_APP_SETTINGS,
	mergeAppSettings,
	parseAppSettings,
} from '../../src/shared/config/app-settings';

describe('parseAppSettings', () => {
	test('fills all defaults from empty / nullish input', () => {
		expect(parseAppSettings(undefined)).toEqual(DEFAULT_APP_SETTINGS);
		expect(parseAppSettings({})).toEqual(DEFAULT_APP_SETTINGS);
		expect(parseAppSettings({ general: {}, models: {} })).toEqual(
			DEFAULT_APP_SETTINGS,
		);
	});

	test('keeps valid fields and defaults the rest', () => {
		const parsed = parseAppSettings({
			general: { sendShortcut: 'mod+enter' },
			models: { defaultModel: 'anthropic/claude-opus-4-8' },
		});
		expect(parsed.general.sendShortcut).toBe('mod+enter');
		expect(parsed.general.followUpBehavior).toBe('steer'); // default
		expect(parsed.models.defaultModel).toBe('anthropic/claude-opus-4-8');
		expect(parsed.models.hiddenModels).toEqual([]); // default
	});

	test('falls back per-field on invalid values', () => {
		const parsed = parseAppSettings({
			general: { sendShortcut: 'bogus', toolCallCollapse: 42 },
			models: { hiddenModels: 'not-an-array' },
		});
		expect(parsed.general.sendShortcut).toBe('enter');
		expect(parsed.general.toolCallCollapse).toBe('collapsed');
		expect(parsed.models.hiddenModels).toEqual([]);
	});

	test('drops unknown keys', () => {
		const parsed = parseAppSettings({
			general: { sendShortcut: 'enter', nope: true },
		}) as unknown as Record<string, Record<string, unknown>>;
		expect('nope' in parsed.general).toBe(false);
	});

	test('tolerates a non-object section', () => {
		expect(parseAppSettings({ general: 'oops', models: 7 })).toEqual(
			DEFAULT_APP_SETTINGS,
		);
	});
});

describe('mergeAppSettings', () => {
	test('applies a section-scoped patch immutably', () => {
		const next = mergeAppSettings(DEFAULT_APP_SETTINGS, {
			general: { caffeinateWhileRunning: true },
			models: { hiddenModels: ['x/y'] },
		});
		expect(next.general.caffeinateWhileRunning).toBe(true);
		expect(next.general.sendShortcut).toBe('enter'); // untouched
		expect(next.models.hiddenModels).toEqual(['x/y']);
		// original is not mutated
		expect(DEFAULT_APP_SETTINGS.general.caffeinateWhileRunning).toBe(false);
	});
});

describe('appSettingsPatchSchema', () => {
	test('accepts a partial patch and strips unknown keys', () => {
		const parsed = appSettingsPatchSchema.parse({
			general: { sendShortcut: 'mod+enter', bogus: 1 },
		});
		expect(parsed.general?.sendShortcut).toBe('mod+enter');
		expect(parsed.general && 'bogus' in parsed.general).toBe(false);
		expect(parsed.models).toBeUndefined();
	});
});
