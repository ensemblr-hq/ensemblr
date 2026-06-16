import { describe, expect, test } from 'bun:test';

import {
	buildFileTree,
	fileTreeIndentClassName,
	getCompactFileDirectory,
	listDirectoryPaths,
} from '../../src/renderer/lib/workbench/file-tree';

interface Entry {
	id: string;
	kind?: 'directory' | 'file';
	name: string;
	path: string;
}

function dir(path: string): Entry {
	return { id: `dir:${path}`, kind: 'directory', name: basename(path), path };
}

function file(path: string): Entry {
	return { id: `file:${path}`, kind: 'file', name: basename(path), path };
}

function basename(path: string): string {
	return path.split('/').pop() ?? path;
}

describe('buildFileTree', () => {
	test('infers ancestor directories from a files-only list', () => {
		const tree = buildFileTree([
			file('src/renderer/app.tsx'),
			file('src/main/main.ts'),
		]);

		expect(tree.directories.map((node) => node.path)).toEqual(['src']);
		const src = tree.directories[0];
		expect(src.directories.map((node) => node.name).sort()).toEqual([
			'main',
			'renderer',
		]);
		expect(src.files).toHaveLength(0);
		const renderer = src.directories.find((node) => node.name === 'renderer');
		expect(renderer?.files.map((entry) => entry.path)).toEqual([
			'src/renderer/app.tsx',
		]);
	});

	test('places files at the correct depth with full directory paths', () => {
		const tree = buildFileTree([file('node_modules/.vite/deps/react.js')]);
		const node = tree.directories[0].directories[0].directories[0];

		expect(node.path).toBe('node_modules/.vite/deps');
		expect(node.files[0].path).toBe('node_modules/.vite/deps/react.js');
	});

	test('keeps explicit empty directory entries as folders', () => {
		const tree = buildFileTree([dir('docs'), dir('src'), file('src/app.ts')]);

		const docs = tree.directories.find((node) => node.name === 'docs');
		expect(docs).toBeDefined();
		expect(docs?.directories).toHaveLength(0);
		expect(docs?.files).toHaveLength(0);

		const src = tree.directories.find((node) => node.name === 'src');
		expect(src?.files.map((entry) => entry.path)).toEqual(['src/app.ts']);
	});

	test('merges explicit directory rows with their inferred counterparts', () => {
		const tree = buildFileTree([
			dir('src'),
			dir('src/lib'),
			file('src/lib/util.ts'),
		]);

		expect(tree.directories).toHaveLength(1);
		const src = tree.directories[0];
		expect(src.directories).toHaveLength(1);
		expect(src.directories[0].path).toBe('src/lib');
		expect(src.directories[0].files.map((entry) => entry.path)).toEqual([
			'src/lib/util.ts',
		]);
	});

	test('ignores empty and root-only paths', () => {
		const tree = buildFileTree([
			{ id: 'empty', kind: 'file', name: '', path: '' },
			{ id: 'slash', kind: 'directory', name: '', path: '/' },
		]);

		expect(tree.directories).toHaveLength(0);
		expect(tree.files).toHaveLength(0);
	});

	test('treats entries without a kind as files', () => {
		const tree = buildFileTree([{ id: 'a', path: 'a/b.txt' }]);

		expect(tree.directories[0].name).toBe('a');
		expect(tree.directories[0].files[0].path).toBe('a/b.txt');
	});

	test('orders directories by name and files by path', () => {
		const tree = buildFileTree([
			file('src/zeta.ts'),
			file('src/alpha.ts'),
			dir('src/zebra'),
			dir('src/apple'),
		]);
		const src = tree.directories[0];

		expect(src.directories.map((node) => node.name)).toEqual([
			'apple',
			'zebra',
		]);
		expect(src.files.map((entry) => entry.path)).toEqual([
			'src/alpha.ts',
			'src/zeta.ts',
		]);
	});

	test('orders top-level directories alphabetically', () => {
		const tree = buildFileTree([file('beta/x.ts'), file('alpha/y.ts')]);

		expect(tree.directories.map((node) => node.name)).toEqual([
			'alpha',
			'beta',
		]);
	});
});

describe('fileTreeIndentClassName', () => {
	test('maps depth to the matching padding class and caps at pl-16', () => {
		expect(fileTreeIndentClassName(-1)).toBe('');
		expect(fileTreeIndentClassName(0)).toBe('');
		expect(fileTreeIndentClassName(1)).toBe('pl-6');
		expect(fileTreeIndentClassName(2)).toBe('pl-10');
		expect(fileTreeIndentClassName(3)).toBe('pl-14');
		expect(fileTreeIndentClassName(4)).toBe('pl-16');
		expect(fileTreeIndentClassName(9)).toBe('pl-16');
	});
});

describe('listDirectoryPaths', () => {
	test('returns every directory path depth-first in sorted order', () => {
		const tree = buildFileTree([
			file('src/lib/util.ts'),
			file('src/app.ts'),
			file('docs/readme.md'),
		]);

		expect(listDirectoryPaths(tree)).toEqual(['docs', 'src', 'src/lib']);
	});

	test('is empty for a tree with no directories', () => {
		expect(listDirectoryPaths(buildFileTree([]))).toEqual([]);
	});
});

describe('getCompactFileDirectory', () => {
	test('collapses chains of single-child directories', () => {
		const tree = buildFileTree([file('node_modules/.vite/deps/react.js')]);
		const compact = getCompactFileDirectory(tree.directories[0]);

		expect(compact.labelParts).toEqual(['node_modules', '.vite', 'deps']);
		expect(compact.node.path).toBe('node_modules/.vite/deps');
		expect(compact.node.files).toHaveLength(1);
	});

	test('stops collapsing at a directory that holds files', () => {
		const tree = buildFileTree([file('src/index.ts'), file('src/lib/util.ts')]);
		const compact = getCompactFileDirectory(tree.directories[0]);

		expect(compact.labelParts).toEqual(['src']);
		expect(compact.node.path).toBe('src');
	});

	test('stops collapsing at a directory with multiple children', () => {
		const tree = buildFileTree([file('a/b/x.ts'), file('a/c/y.ts')]);
		const compact = getCompactFileDirectory(tree.directories[0]);

		expect(compact.labelParts).toEqual(['a']);
		expect(compact.node.directories).toHaveLength(2);
	});
});
