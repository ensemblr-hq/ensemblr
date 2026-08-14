import { describe, expect, test } from 'vitest';

import { createWorkspacePathResolver } from '../../src/renderer/lib/agent-timeline';
import type { WorkspaceFileSummary } from '../../src/renderer/types/workbench';

function file(path: string): WorkspaceFileSummary {
	return {
		id: path,
		kind: 'file',
		name: path.split('/').at(-1) ?? path,
		path,
	};
}

function directory(path: string): WorkspaceFileSummary {
	return {
		id: path,
		kind: 'directory',
		name: path.split('/').at(-1) ?? path,
		path,
	};
}

const FILES: readonly WorkspaceFileSummary[] = [
	directory('src'),
	directory('src/renderer'),
	directory('src/renderer/components'),
	file('src/renderer/components/message.tsx'),
	file('src/renderer/components/code-surface.tsx'),
	file('src/main/components/message.tsx'),
	file('README.md'),
];

describe('workspace path resolver', () => {
	test('resolves an exact workspace-relative path to its entry', () => {
		const resolve = createWorkspacePathResolver(FILES, null);

		expect(resolve('src/renderer/components/message.tsx')).toEqual({
			kind: 'file',
			path: 'src/renderer/components/message.tsx',
			scope: 'workspace',
		});
		expect(resolve('src/renderer')).toEqual({
			kind: 'directory',
			path: 'src/renderer',
			scope: 'workspace',
		});
	});

	test('strips the workspace root from an absolute path', () => {
		const resolve = createWorkspacePathResolver(FILES, '/repo');

		expect(resolve('/repo/README.md')).toEqual({
			kind: 'file',
			path: 'README.md',
			scope: 'workspace',
		});
	});

	test('resolves a truncated path when exactly one entry ends with it', () => {
		const resolve = createWorkspacePathResolver(FILES, null);

		expect(resolve('renderer/components/message.tsx')).toEqual({
			kind: 'file',
			path: 'src/renderer/components/message.tsx',
			scope: 'workspace',
		});
		expect(resolve('./components/code-surface.tsx')).toEqual({
			kind: 'file',
			path: 'src/renderer/components/code-surface.tsx',
			scope: 'workspace',
		});
	});

	test('refuses to guess when a truncated path matches more than one entry', () => {
		const resolve = createWorkspacePathResolver(FILES, null);

		expect(resolve('components/message.tsx')).toBeNull();
		expect(resolve('message.tsx')).toBeNull();
	});

	test('matches only on whole path segments', () => {
		const resolve = createWorkspacePathResolver(FILES, null);

		expect(resolve('age.tsx')).toBeNull();
		expect(resolve('r/components/code-surface.tsx')).toBeNull();
	});

	test('reports a path the workspace does not contain as missing', () => {
		const resolve = createWorkspacePathResolver(FILES, null);

		expect(resolve('src/renderer/components/deleted.tsx')).toBeNull();
	});

	test('resolves optimistically while the file tree is empty', () => {
		const resolve = createWorkspacePathResolver([], null);

		expect(resolve('src/anything.ts')).toEqual({
			kind: 'file',
			path: 'src/anything.ts',
			scope: 'workspace',
		});
	});

	test('refuses a climb above the root when the workspace root is unknown', () => {
		const known = createWorkspacePathResolver(FILES, null);
		const optimistic = createWorkspacePathResolver([], null);

		expect(known('../../etc/passwd')).toBeNull();
		expect(known('src/../../etc/passwd')).toBeNull();
		expect(optimistic('../../etc/passwd')).toBeNull();
		expect(optimistic('./../secrets.env')).toBeNull();
	});

	test('anchors a climb above the root on the workspace root as external', () => {
		const resolve = createWorkspacePathResolver(FILES, '/repos/app');

		expect(resolve('../sibling/notes.md')).toEqual({
			kind: 'file',
			path: '/repos/sibling/notes.md',
			scope: 'external',
		});
		expect(resolve('src/../../sibling/notes.md')).toEqual({
			kind: 'file',
			path: '/repos/sibling/notes.md',
			scope: 'external',
		});
	});

	test('refuses a climb that escapes past the filesystem root', () => {
		const resolve = createWorkspacePathResolver(FILES, '/repos/app');

		expect(resolve('../../../../etc/passwd')).toBeNull();
	});

	test('resolves an absolute path outside the workspace without the tree', () => {
		const resolve = createWorkspacePathResolver(FILES, '/repo');

		expect(resolve('/tmp/scratch.md')).toEqual({
			kind: 'file',
			path: '/tmp/scratch.md',
			scope: 'external',
		});
		expect(resolve('~/.claude/plans/plan.md')).toEqual({
			kind: 'file',
			path: '~/.claude/plans/plan.md',
			scope: 'external',
		});
	});

	test('keeps an absolute in-workspace path on the workspace scope', () => {
		const resolve = createWorkspacePathResolver(FILES, '/repo');

		expect(resolve('/repo/README.md')).toEqual({
			kind: 'file',
			path: 'README.md',
			scope: 'workspace',
		});
	});

	test('resolves an outside path even when the tree has never loaded', () => {
		const resolve = createWorkspacePathResolver([], '/repo');

		expect(resolve('/tmp/scratch.md')).toEqual({
			kind: 'file',
			path: '/tmp/scratch.md',
			scope: 'external',
		});
	});

	test('resolves interior dot segments instead of passing them through', () => {
		const known = createWorkspacePathResolver(FILES, null);
		const optimistic = createWorkspacePathResolver([], null);

		expect(known('src/renderer/./components/message.tsx')).toEqual({
			kind: 'file',
			path: 'src/renderer/components/message.tsx',
			scope: 'workspace',
		});
		expect(known('src/main/../renderer/components/code-surface.tsx')).toEqual({
			kind: 'file',
			path: 'src/renderer/components/code-surface.tsx',
			scope: 'workspace',
		});
		expect(optimistic('src/lib/../anything.ts')).toEqual({
			kind: 'file',
			path: 'src/anything.ts',
			scope: 'workspace',
		});
	});
});
