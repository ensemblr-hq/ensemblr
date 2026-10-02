import { describe, expect, test } from 'vitest';

import { buildFileTree } from '../../src/renderer/lib/workbench/file-tree';
import {
	buildReviewFlatRows,
	buildReviewTreeRows,
	reviewRowSize,
} from '../../src/renderer/lib/workbench/review-file-rows';
import type { ReviewFileSummary } from '../../src/renderer/types/workbench';

/** Builds a modified file row whose id mirrors the git status mapper. */
function file(path: string): ReviewFileSummary {
	return {
		additions: 1,
		contentId: null,
		deletions: 0,
		id: `git:${path}`,
		path,
		status: 'modified',
	};
}

describe('buildReviewFlatRows', () => {
	test('lists files in the given order keyed by file id', () => {
		const files = [file('b.ts'), file('a.ts')];

		const rows = buildReviewFlatRows(files, null);

		expect(rows.map((row) => row.key)).toEqual(['git:b.ts', 'git:a.ts']);
		expect(rows.every((row) => row.type === 'file' && row.showPath)).toBe(true);
		expect(rows.every((row) => row.type === 'file' && row.level === 0)).toBe(
			true,
		);
		expect(
			rows.every((row) => row.type === 'file' && row.ariaLevel === undefined),
		).toBe(true);
	});

	test('splits into a conflicts band then a clean band, headers included', () => {
		const conflicted = [file('c1.ts'), file('c2.ts')];
		const clean = [file('ok-unviewed.ts'), file('ok-viewed.ts')];

		const rows = buildReviewFlatRows([...conflicted, ...clean], {
			clean,
			conflicted,
		});

		expect(
			rows.map((row) => (row.type === 'group' ? row.group : row.key)),
		).toEqual([
			'conflicts',
			'git:c1.ts',
			'git:c2.ts',
			'clean',
			'git:ok-unviewed.ts',
			'git:ok-viewed.ts',
		]);
	});

	test('omits the clean header when every changed file conflicts', () => {
		const conflicted = [file('c1.ts')];

		const rows = buildReviewFlatRows(conflicted, { clean: [], conflicted });

		expect(rows.map((row) => row.type)).toEqual(['group', 'file']);
	});
});

describe('buildReviewTreeRows', () => {
	const tree = buildFileTree([
		file('README.md'),
		file('src/main/a.ts'),
		file('src/main/b.ts'),
		file('src/ui/deep/only/c.ts'),
		file('src/z.ts'),
	]);

	test('puts directories before files, compacts chains and tracks levels', () => {
		const rows = buildReviewTreeRows(tree, () => true);

		expect(
			rows.map((row) => {
				if (row.type === 'directory') {
					return `dir:${row.path}:${row.level}:${row.labelParts.join('/')}`;
				}
				if (row.type === 'file') {
					return `file:${row.key}:${row.level}:${row.ariaLevel}:${row.showPath}`;
				}
				return `group:${row.group}`;
			}),
		).toEqual([
			'dir:src:0:src',
			'dir:src/main:1:main',
			'file:file:git:src/main/a.ts:2:3:false',
			'file:file:git:src/main/b.ts:2:3:false',
			'dir:src/ui/deep/only:1:ui/deep/only',
			'file:file:git:src/ui/deep/only/c.ts:2:3:false',
			'file:file:git:src/z.ts:1:2:false',
			'file:file:git:README.md:0:1:true',
		]);
	});

	test('skips the subtree of a collapsed directory', () => {
		const rows = buildReviewTreeRows(tree, (path) => path !== 'src/main');

		const keys = rows.map((row) => row.key);
		expect(keys).toContain('directory:src/main');
		expect(keys).not.toContain('file:git:src/main/a.ts');
		expect(keys).toContain('file:git:src/ui/deep/only/c.ts');
		const collapsed = rows.find((row) => row.key === 'directory:src/main');
		expect(collapsed?.type === 'directory' && collapsed.isExpanded).toBe(false);
	});

	test('keys a folder and a deleted file of the same name apart', () => {
		const deletedFoo: ReviewFileSummary = {
			...file('foo'),
			status: 'deleted',
		};

		const rows = buildReviewTreeRows(
			buildFileTree([deletedFoo, file('foo/bar')]),
			() => true,
		);

		const keys = rows.map((row) => row.key);
		expect(keys).toHaveLength(3);
		expect(new Set(keys).size).toBe(3);
	});

	test('numbers each row among its own siblings, not the visible list', () => {
		const rows = buildReviewTreeRows(tree, () => true);

		expect(
			rows.map((row) =>
				row.type === 'group'
					? row.group
					: `${row.type}:${row.ariaPosInSet}/${row.ariaSetSize}`,
			),
		).toEqual([
			'directory:1/2',
			'directory:1/3',
			'file:1/2',
			'file:2/2',
			'directory:2/3',
			'file:1/1',
			'file:3/3',
			'file:2/2',
		]);
	});

	test('counts only siblings when a collapsed folder hides its children', () => {
		const rows = buildReviewTreeRows(tree, (path) => path !== 'src');

		expect(
			rows.map((row) =>
				row.type === 'group'
					? row.group
					: `${row.type}:${row.ariaPosInSet}/${row.ariaSetSize}`,
			),
		).toEqual(['directory:1/2', 'file:2/2']);
	});
});

describe('reviewRowSize', () => {
	test('keeps the pitch of the unvirtualized list: row height plus its gap', () => {
		const [fileRow] = buildReviewFlatRows([file('a.ts')], null);
		const [groupRow] = buildReviewFlatRows([file('a.ts')], {
			clean: [],
			conflicted: [file('a.ts')],
		});
		const [directoryRow] = buildReviewTreeRows(
			buildFileTree([file('src/a.ts')]),
			() => true,
		);

		expect(reviewRowSize(fileRow)).toBe(36);
		expect(reviewRowSize(directoryRow)).toBe(32);
		expect(reviewRowSize(groupRow)).toBe(24);
	});
});
