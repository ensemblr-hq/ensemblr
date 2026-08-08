import { describe, expect, test } from 'vitest';

import {
	decayUsageScore,
	getUsageBoost,
	MAX_SLASH_COMMAND_BOOST,
	recordSlashCommandUse,
	SLASH_COMMAND_USAGE_HALF_LIFE_DAYS,
	type SlashCommandUsageMap,
} from '../../src/renderer/state/slash-commands/usage';

const NOW = 1_800_000_000_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('recordSlashCommandUse', () => {
	test('returns a new map and leaves the input untouched', () => {
		const before: SlashCommandUsageMap = {};
		const after = recordSlashCommandUse(before, 'code-review', NOW);
		expect(before).toEqual({});
		expect(after['code-review']).toEqual({ lastUsedAt: NOW, score: 1 });
	});

	test('accumulates repeated picks', () => {
		let usage: SlashCommandUsageMap = {};
		for (let index = 0; index < 3; index += 1) {
			usage = recordSlashCommandUse(usage, 'code-review', NOW);
		}
		expect(usage['code-review'].score).toBe(3);
	});

	test('ignores a blank command name', () => {
		const usage = recordSlashCommandUse({}, '', NOW);
		expect(usage).toEqual({});
	});
});

describe('decayUsageScore', () => {
	test('halves a weight over exactly one half-life', () => {
		const usage = { lastUsedAt: NOW, score: 4 };
		const later = NOW + SLASH_COMMAND_USAGE_HALF_LIFE_DAYS * MS_PER_DAY;
		expect(decayUsageScore(usage, later)).toBeCloseTo(2, 10);
	});

	test('an unknown command weighs nothing', () => {
		expect(decayUsageScore(undefined, NOW)).toBe(0);
	});

	test('corrupt stored values weigh nothing rather than poisoning a sort', () => {
		expect(decayUsageScore({ lastUsedAt: NOW, score: Number.NaN }, NOW)).toBe(
			0,
		);
		expect(decayUsageScore({ lastUsedAt: Number.NaN, score: 5 }, NOW)).toBe(0);
	});
});

describe('getUsageBoost', () => {
	// A comparator that ever sees NaN silently preserves input order, which would
	// look exactly like the ranking feature not being wired up at all.
	test('is always a finite number, including for an unknown command', () => {
		expect(getUsageBoost({}, 'never-used', NOW)).toBe(0);
		expect(Number.isFinite(getUsageBoost({}, 'never-used', NOW))).toBe(true);
	});

	test('grows with use but never exceeds its ceiling', () => {
		const once = getUsageBoost(
			recordSlashCommandUse({}, 'code-review', NOW),
			'code-review',
			NOW,
		);
		let heavy: SlashCommandUsageMap = {};
		for (let index = 0; index < 200; index += 1) {
			heavy = recordSlashCommandUse(heavy, 'code-review', NOW);
		}
		const often = getUsageBoost(heavy, 'code-review', NOW);
		expect(once).toBeGreaterThan(0);
		expect(often).toBeGreaterThan(once);
		expect(often).toBeLessThanOrEqual(MAX_SLASH_COMMAND_BOOST);
	});

	test('fades a command that has not been used in a long time', () => {
		const usage = recordSlashCommandUse({}, 'code-review', NOW);
		const muchLater = NOW + 365 * MS_PER_DAY;
		expect(getUsageBoost(usage, 'code-review', muchLater)).toBeLessThan(
			getUsageBoost(usage, 'code-review', NOW),
		);
	});
});
