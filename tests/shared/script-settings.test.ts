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
				'scripts.setup': 'bun install',
			}),
		);

		expect(parsed).toEqual({
			autoRunAfterSetup: true,
			runScriptMode: 'nonconcurrent',
			runScripts: [],
			scripts: {
				archive: 'bun run archive',
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
			runScripts: [],
			scripts: {},
		});
	});

	test('defaults auto-run to false when the key is absent', () => {
		expect(
			parseWorkspaceScriptSettings(entries({ 'scripts.setup': 'bun install' }))
				.autoRunAfterSetup,
		).toBe(false);
	});

	test('upgrades a legacy run string into an implicit default script', () => {
		expect(
			parseWorkspaceScriptSettings(entries({ 'scripts.run': 'bun run dev' }))
				.runScripts,
		).toEqual([
			{
				availableIn: null,
				command: 'bun run dev',
				icon: 'play',
				isDefault: true,
				name: 'run',
			},
		]);
	});

	test('prefers the named run scripts over a legacy run string', () => {
		const parsed = parseWorkspaceScriptSettings(
			entries({
				'scripts.run': 'bun run dev',
				'scripts.runScripts': [
					{
						command: 'npm run dev',
						default: true,
						icon: 'server',
						name: 'dev',
					},
					{ command: 'npm test', name: 'test' },
				],
			}),
		);

		expect(parsed.runScripts.map((script) => script.name)).toEqual([
			'dev',
			'test',
		]);
		expect(parsed.runScripts[0]?.icon).toBe('server');
	});

	test('drops run scripts unavailable in the local environment', () => {
		const parsed = parseWorkspaceScriptSettings(
			entries({
				'scripts.runScripts': [
					{
						available_in: ['cloud'],
						command: 'npm run remote',
						name: 'remote',
					},
					{ available_in: ['local'], command: 'npm run dev', name: 'dev' },
				],
			}),
		);

		expect(parsed.runScripts.map((script) => script.name)).toEqual(['dev']);
	});

	test('ignores a malformed run-scripts value', () => {
		expect(
			parseWorkspaceScriptSettings(entries({ 'scripts.runScripts': 'nope' }))
				.runScripts,
		).toEqual([]);
	});
});
