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
			runTargets: [{ command: 'bun run dev', id: 'default', name: '' }],
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
			runTargets: [],
			scripts: {},
		});
	});

	test('defaults auto-run to false when the key is absent', () => {
		expect(
			parseWorkspaceScriptSettings(entries({ 'scripts.setup': 'bun install' }))
				.autoRunAfterSetup,
		).toBe(false);
	});

	test('parses an array of named run targets, deriving ids from names', () => {
		const parsed = parseWorkspaceScriptSettings(
			entries({
				'scripts.run': [
					{ command: 'npm run dev:web', name: 'Web' },
					{ command: 'npm run dev:api', name: 'API' },
				],
			}),
		);

		expect(parsed.runTargets).toEqual([
			{ command: 'npm run dev:web', id: 'web', name: 'Web' },
			{ command: 'npm run dev:api', id: 'api', name: 'API' },
		]);
	});

	test('prefers an explicit id over a derived slug', () => {
		const parsed = parseWorkspaceScriptSettings(
			entries({
				'scripts.run': [
					{ command: 'npm run dev', id: 'stable-id', name: 'Web' },
				],
			}),
		);

		expect(parsed.runTargets).toEqual([
			{ command: 'npm run dev', id: 'stable-id', name: 'Web' },
		]);
	});

	test('de-duplicates colliding slugs with a numeric suffix', () => {
		const parsed = parseWorkspaceScriptSettings(
			entries({
				'scripts.run': [
					{ command: 'npm run dev:web', name: 'Web' },
					{ command: 'npm run dev:web2', name: 'Web' },
				],
			}),
		);

		expect(parsed.runTargets.map((target) => target.id)).toEqual([
			'web',
			'web-2',
		]);
	});

	test('drops array entries with a blank command and falls back to a positional slug for a blank name', () => {
		const parsed = parseWorkspaceScriptSettings(
			entries({
				'scripts.run': [
					{ command: '   ', name: 'Skipped' },
					{ command: 'npm run dev' },
				],
			}),
		);

		expect(parsed.runTargets).toEqual([
			{ command: 'npm run dev', id: 'run', name: '' },
		]);
	});
});
