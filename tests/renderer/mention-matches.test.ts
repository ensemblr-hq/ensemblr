import { expect, test } from 'vitest';
import { getMentionMatches } from '../../src/renderer/hooks/workbench-shell/composer/use-mention-matches';
import type { WorkspaceFileSummary } from '../../src/renderer/types/workbench';

const FILES: WorkspaceFileSummary[] = [
	{ id: 'dir-src', kind: 'directory', name: 'src', path: 'src' },
	{ id: 'dir-docs', kind: 'directory', name: 'docs', path: 'docs' },
	{ id: 'file-readme', kind: 'file', name: 'README.md', path: 'README.md' },
	{
		id: 'file-package',
		kind: 'file',
		name: 'package.json',
		path: 'package.json',
	},
	{
		id: 'dir-src-renderer',
		kind: 'directory',
		name: 'renderer',
		path: 'src/renderer',
	},
	{ id: 'dir-src-main', kind: 'directory', name: 'main', path: 'src/main' },
	{ id: 'file-src-main', kind: 'file', name: 'main.ts', path: 'src/main.ts' },
	{ id: 'file-src-app', kind: 'file', name: 'app.tsx', path: 'src/app.tsx' },
	{
		id: 'file-src-renderer-index',
		kind: 'file',
		name: 'index.tsx',
		path: 'src/renderer/index.tsx',
	},
	{
		id: 'file-docs-readme',
		kind: 'file',
		name: 'README.md',
		path: 'docs/README.md',
	},
];

test('empty @ mention shows root folders then root files only', () => {
	const paths = getMentionMatches(FILES, '').map((entry) => entry.path);

	expect(paths).toEqual(['docs', 'src', 'package.json', 'README.md']);
});

test('@ mention drills into a matching root folder as query gets specific', () => {
	const paths = getMentionMatches(FILES, 'sr').map((entry) => entry.path);

	expect(paths.slice(0, 5)).toEqual([
		'src',
		'src/main',
		'src/renderer',
		'src/app.tsx',
		'src/main.ts',
	]);
});

test('@ mention with slash shows direct children of that folder', () => {
	const paths = getMentionMatches(FILES, 'src/').map((entry) => entry.path);

	expect(paths).toEqual([
		'src/main',
		'src/renderer',
		'src/app.tsx',
		'src/main.ts',
	]);
});

test('@ mention with nested slash filters direct children by segment', () => {
	const paths = getMentionMatches(FILES, 'src/r').map((entry) => entry.path);

	expect(paths).toEqual(['src/renderer']);
});
