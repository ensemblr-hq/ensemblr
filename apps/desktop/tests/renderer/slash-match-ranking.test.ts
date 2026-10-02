import { describe, expect, test } from 'vitest';

import { rankSlashMatches } from '../../src/renderer/hooks/workbench-shell/composer/use-slash-matches';
import {
	recordSlashCommandUse,
	type SlashCommandUsageMap,
} from '../../src/renderer/state/slash-commands/usage';
import type { SlashCommandDescriptor } from '../../src/renderer/types/workbench';

const NOW = 1_800_000_000_000;

/** Builds a catalogue entry with the fields ranking actually reads. */
function command(
	name: string,
	overrides: Partial<SlashCommandDescriptor> = {},
): SlashCommandDescriptor {
	return {
		autoSubmit: false,
		command: name,
		description: `${name} description`,
		...overrides,
	};
}

/** Records one command a number of times, so a habit can be simulated. */
function usedTimes(name: string, times: number): SlashCommandUsageMap {
	let usage: SlashCommandUsageMap = {};
	for (let index = 0; index < times; index += 1) {
		usage = recordSlashCommandUse(usage, name, NOW);
	}
	return usage;
}

/** Reads back the command names in the order the menu would render them. */
function names(
	commands: readonly SlashCommandDescriptor[],
	query: string,
	usage: SlashCommandUsageMap,
): string[] {
	return rankSlashMatches(commands, query, usage, NOW).map(
		(match) => match.item.command,
	);
}

const CATALOGUE = [
	command('code-analyzer'),
	command('code-review'),
	command('codebase-design'),
];

describe('rankSlashMatches ordering', () => {
	// `codebase-design` only matches `code-` as a subsequence, so it sits below
	// both prefix matches however the two of them are ordered.
	test('alphabetical order stands when nothing has been used', () => {
		expect(names(CATALOGUE, 'code-', {})).toEqual([
			'code-analyzer',
			'code-review',
			'codebase-design',
		]);
	});

	test('a frequently picked command wins a prefix-tier tie', () => {
		expect(names(CATALOGUE, 'code-', usedTimes('code-review', 5))).toEqual([
			'code-review',
			'code-analyzer',
			'codebase-design',
		]);
	});

	test('use beats an earlier substring position inside the same tier', () => {
		const catalogue = [command('my-code-analyzer'), command('run-code-review')];
		expect(names(catalogue, 'code', usedTimes('run-code-review', 5))).toEqual([
			'run-code-review',
			'my-code-analyzer',
		]);
	});

	// The guarantee that makes the boost safe: history reorders rows inside a
	// tier and can never promote a weak match past a stronger kind of match.
	test('heavy use never lifts a subsequence match above a prefix match', () => {
		const catalogue = [command('code-review'), command('context-mode')];
		expect(names(catalogue, 'code', usedTimes('context-mode', 500))).toEqual([
			'code-review',
			'context-mode',
		]);
	});

	test('heavy use never lifts a substring match above an exact match', () => {
		const catalogue = [command('review'), command('code-review')];
		expect(names(catalogue, 'review', usedTimes('code-review', 500))).toEqual([
			'review',
			'code-review',
		]);
	});
});

describe('rankSlashMatches with no query', () => {
	test('used commands lead the bare menu', () => {
		expect(names(CATALOGUE, '', usedTimes('codebase-design', 3))).toEqual([
			'codebase-design',
			'code-analyzer',
			'code-review',
		]);
	});

	// Regression guard: resolving usage with `?.` yields `undefined - undefined`,
	// and a comparator returning NaN preserves input order — the feature would
	// look unwired rather than broken.
	test('one used command among many still sorts to the top', () => {
		const many = Array.from({ length: 50 }, (_, index) =>
			command(`command-${String(index).padStart(2, '0')}`),
		);
		expect(names(many, '', usedTimes('command-40', 1))[0]).toBe('command-40');
	});

	test('unused commands keep the catalogue group order', () => {
		const catalogue = [
			command('user-skill', { source: 'skill', sourceScope: 'user' }),
			command('project-skill', { source: 'skill', sourceScope: 'project' }),
		];
		expect(names(catalogue, '', {})).toEqual(['project-skill', 'user-skill']);
	});
});

describe('rankSlashMatches filtering', () => {
	test('drops commands the query cannot match at all', () => {
		expect(names(CATALOGUE, 'zzz', {})).toEqual([]);
	});

	test('reports the matched spans of each command name', () => {
		const [match] = rankSlashMatches(CATALOGUE, 'code-', {}, NOW);
		expect(match.ranges).toEqual([{ end: 5, start: 0 }]);
	});

	test('honours the row limit', () => {
		expect(rankSlashMatches(CATALOGUE, '', {}, NOW, 2)).toHaveLength(2);
	});
});
