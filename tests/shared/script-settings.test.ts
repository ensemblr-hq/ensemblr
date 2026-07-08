import { describe, expect, test } from 'vitest';

import {
	parseWorkspaceScriptSettings,
	type ResolvedScriptSettingEntry,
} from '../../src/shared/scripts/script-settings';

function entries(
	record: Record<string, unknown>,
): ResolvedScriptSettingEntry[] {
	return Object.entries(record).map(([key, value]) => ({ key, value }));
}

describe('parseWorkspaceScriptSettings', () => {
	test('parses script commands, run mode, and auto-run flag', () => {
		const parsed = parseWorkspaceScriptSettings(
			entries({
				autoRunAfterSetup: true,
				runScriptMode: 'nonconcurrent',
				'scripts.archive': 'bun run archive',
				'scripts.run': 'bun run dev',
				'scripts.setup': 'bun install',
			}),
		);

		expect(parsed).toEqual({
			autoRunAfterSetup: true,
			runScriptMode: 'nonconcurrent',
			scripts: {
				archive: 'bun run archive',
				run: 'bun run dev',
				setup: 'bun install',
			},
		});
	});

	test('applies safe defaults for missing/blank/invalid entries', () => {
		const parsed = parseWorkspaceScriptSettings(
			entries({
				autoRunAfterSetup: 'yes',
				runScriptMode: 'bogus',
				'scripts.run': '   ',
				'scripts.setup': null,
			}),
		);

		expect(parsed).toEqual({
			autoRunAfterSetup: false,
			runScriptMode: 'concurrent',
			scripts: {},
		});
	});

	test('defaults auto-run to false when the key is absent', () => {
		expect(
			parseWorkspaceScriptSettings(entries({ 'scripts.setup': 'bun install' }))
				.autoRunAfterSetup,
		).toBe(false);
	});
});
