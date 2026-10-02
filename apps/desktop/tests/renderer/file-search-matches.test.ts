import { describe, expect, test } from 'vitest';

import { rankFileSearchMatches } from '../../src/renderer/hooks/workbench-shell/review-files/use-file-search-matches';
import type { WorkspaceFileSummary } from '../../src/renderer/types/workbench';

function file(path: string): WorkspaceFileSummary {
	return {
		id: path,
		kind: 'file',
		name: path.split('/').at(-1) ?? path,
		path,
	};
}

function paths(matches: WorkspaceFileSummary[]): string[] {
	return matches.map((match) => match.path);
}

describe('rankFileSearchMatches', () => {
	test('drops directories and symlinks that point at one', () => {
		const entries: WorkspaceFileSummary[] = [
			{ id: 'src', kind: 'directory', name: 'src', path: 'src' },
			{
				id: 'link',
				kind: 'file',
				name: 'link',
				path: 'link',
				symlinkTargetKind: 'directory',
			},
			file('src/index.ts'),
		];

		expect(paths(rankFileSearchMatches(entries, ''))).toEqual(['src/index.ts']);
	});

	test('returns the leading files in listing order for an empty query', () => {
		const entries = [file('b.ts'), file('a.ts'), file('c.ts')];

		expect(paths(rankFileSearchMatches(entries, '   '))).toEqual([
			'b.ts',
			'a.ts',
			'c.ts',
		]);
	});

	test('ranks an exact name above a prefix above a path-only match', () => {
		const entries = [
			file('deep/nested/main/other.ts'),
			file('src/main-runner.ts'),
			file('src/main.ts'),
		];

		expect(paths(rankFileSearchMatches(entries, 'main.ts'))).toEqual([
			'src/main.ts',
			'src/main-runner.ts',
			'deep/nested/main/other.ts',
		]);
	});

	test('excludes files the query does not match at all', () => {
		const entries = [file('src/index.ts'), file('docs/readme.md')];

		expect(paths(rankFileSearchMatches(entries, 'index'))).toEqual([
			'src/index.ts',
		]);
	});

	test('matches case-insensitively', () => {
		const entries = [file('src/ReadMe.md')];

		expect(paths(rankFileSearchMatches(entries, 'readme'))).toEqual([
			'src/ReadMe.md',
		]);
	});

	test('caps both the empty-query and the scored result set', () => {
		const entries = Array.from({ length: 40 }, (_unused, index) =>
			file(`src/file-${index}.ts`),
		);

		expect(rankFileSearchMatches(entries, '', 10)).toHaveLength(10);
		expect(rankFileSearchMatches(entries, 'file', 10)).toHaveLength(10);
	});

	test('orders equally scored matches by shortest path, then alphabetically', () => {
		const entries = [
			file('zz/a.ts'),
			file('a.ts'),
			file('bb/a.ts'),
			file('aa/a.ts'),
		];

		expect(paths(rankFileSearchMatches(entries, 'a.ts'))).toEqual([
			'a.ts',
			'aa/a.ts',
			'bb/a.ts',
			'zz/a.ts',
		]);
	});
});
