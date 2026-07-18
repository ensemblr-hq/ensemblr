import { describe, expect, test } from 'vitest';

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

	test('applies appearance defaults', () => {
		const appearance = parseAppSettings({}).appearance;
		expect(appearance).toEqual({
			theme: 'system',
			accessibleColors: 'default',
			codeTheme: 'catppuccin-mocha',
			monoFont: 'JetBrainsMono Nerd Font Mono',
			codeLigatures: true,
			markdownStyle: 'default',
			terminalFont: 'JetBrainsMono Nerd Font Mono',
			terminalFontSize: 12,
		});
	});

	test('keeps valid appearance values and defaults invalid ones', () => {
		const parsed = parseAppSettings({
			appearance: {
				theme: 'dark',
				codeTheme: 'one-dark-pro',
				monoFont: 'Fira Code',
				accessibleColors: 'protanopia',
				markdownStyle: 'not-a-style', // invalid → default
				terminalFontSize: 99, // out of range → default
			},
		}).appearance;
		expect(parsed.theme).toBe('dark');
		expect(parsed.codeTheme).toBe('one-dark-pro');
		expect(parsed.monoFont).toBe('Fira Code');
		expect(parsed.accessibleColors).toBe('protanopia');
		expect(parsed.markdownStyle).toBe('default'); // fell back
		expect(parsed.terminalFontSize).toBe(12); // fell back
		expect(parsed.codeLigatures).toBe(true); // untouched default
	});

	test('parses the git section with resolution-aligned keys', () => {
		const parsed = parseAppSettings({
			git: {
				branchPrefixSource: 'custom',
				branchPrefixCustom: 'feat/',
				archiveAfterMerge: 'yes', // invalid → default
			},
		});
		expect(parsed.git.branchPrefixSource).toBe('custom');
		expect(parsed.git.branchPrefixCustom).toBe('feat/');
		expect(parsed.git.archiveAfterMerge).toBe(false); // default
		expect(parsed.git.deleteLocalBranchOnArchive).toBe(false); // default
		expect(parsed.git.setUpstreamOnPush).toBe(true); // default
		expect(parsed.git.renameWorkspaceOnBranch).toBe(true); // default
	});

	test('parses the experimental auto-run default', () => {
		const parsed = parseAppSettings({
			experimental: { autoRunAfterSetup: true },
		});
		expect(parsed.experimental.autoRunAfterSetup).toBe(true);
		expect(
			parseAppSettings({ experimental: { autoRunAfterSetup: 'yes' } })
				.experimental.autoRunAfterSetup,
		).toBe(false);
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

	test('merges the git section immutably', () => {
		const next = mergeAppSettings(DEFAULT_APP_SETTINGS, {
			git: { deleteLocalBranchOnArchive: true },
		});
		expect(next.git.deleteLocalBranchOnArchive).toBe(true);
		expect(next.git.setUpstreamOnPush).toBe(true); // untouched default
		expect(DEFAULT_APP_SETTINGS.git.deleteLocalBranchOnArchive).toBe(false);
	});

	test('merges the appearance section immutably', () => {
		const next = mergeAppSettings(DEFAULT_APP_SETTINGS, {
			appearance: { monoFont: 'Fira Code', codeLigatures: false },
		});
		expect(next.appearance.monoFont).toBe('Fira Code');
		expect(next.appearance.codeLigatures).toBe(false);
		expect(next.appearance.theme).toBe('system'); // untouched default
		expect(DEFAULT_APP_SETTINGS.appearance.monoFont).toBe(
			'JetBrainsMono Nerd Font Mono',
		);
	});

	test('merges the experimental section immutably', () => {
		const next = mergeAppSettings(DEFAULT_APP_SETTINGS, {
			experimental: { autoRunAfterSetup: true },
		});
		expect(next.experimental.autoRunAfterSetup).toBe(true);
		expect(DEFAULT_APP_SETTINGS.experimental.autoRunAfterSetup).toBe(false);
	});
});

describe('appSettingsPatchSchema', () => {
	test('accepts a partial patch and strips unknown keys', () => {
		const parsed = appSettingsPatchSchema.parse({
			experimental: { autoRunAfterSetup: true },
			general: { sendShortcut: 'mod+enter', bogus: 1 },
		});
		expect(parsed.general?.sendShortcut).toBe('mod+enter');
		expect(parsed.general && 'bogus' in parsed.general).toBe(false);
		expect(parsed.experimental?.autoRunAfterSetup).toBe(true);
		expect(parsed.models).toBeUndefined();
	});
});
