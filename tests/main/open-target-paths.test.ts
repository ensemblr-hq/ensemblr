import { describe, expect, test } from 'vitest';

import {
	resolveOpenTargetPath,
	sanitizeWorkspaceRelativePath,
} from '../../src/main/open-target/open-target-paths';

const WORKSPACE = '/repo/workspace';

describe('sanitizeWorkspaceRelativePath', () => {
	test('returns undefined when no path is provided', () => {
		expect(sanitizeWorkspaceRelativePath(undefined)).toBeUndefined();
		expect(sanitizeWorkspaceRelativePath('')).toBeUndefined();
	});

	test('normalizes a safe relative path', () => {
		expect(sanitizeWorkspaceRelativePath('src/app.ts')).toBe('src/app.ts');
		expect(sanitizeWorkspaceRelativePath('./src/./app.ts')).toBe('src/app.ts');
	});

	test('rejects traversal outside the workspace', () => {
		expect(sanitizeWorkspaceRelativePath('..')).toBeNull();
		expect(sanitizeWorkspaceRelativePath('../secrets')).toBeNull();
		expect(sanitizeWorkspaceRelativePath('../../etc/passwd')).toBeNull();
	});

	test('rejects absolute paths', () => {
		expect(sanitizeWorkspaceRelativePath('/etc/passwd')).toBeNull();
	});
});

describe('resolveOpenTargetPath', () => {
	test('opens the workspace root when no relative path is given', () => {
		expect(
			resolveOpenTargetPath({ kind: 'editor', workspacePath: WORKSPACE }),
		).toBe(WORKSPACE);
	});

	test('opens the exact file for editors and file managers', () => {
		for (const kind of ['editor', 'file-manager', 'utility'] as const) {
			expect(
				resolveOpenTargetPath({
					kind,
					relativePath: 'src/app.ts',
					relativePathKind: 'file',
					workspacePath: WORKSPACE,
				}),
			).toBe('/repo/workspace/src/app.ts');
		}
	});

	test('opens a file’s parent directory for terminals and git GUIs', () => {
		for (const kind of ['terminal', 'source-control'] as const) {
			expect(
				resolveOpenTargetPath({
					kind,
					relativePath: 'src/lib/app.ts',
					relativePathKind: 'file',
					workspacePath: WORKSPACE,
				}),
			).toBe('/repo/workspace/src/lib');
		}
	});

	test('opens the directory itself for terminals when the row is a folder', () => {
		expect(
			resolveOpenTargetPath({
				kind: 'terminal',
				relativePath: 'src/lib',
				relativePathKind: 'directory',
				workspacePath: WORKSPACE,
			}),
		).toBe('/repo/workspace/src/lib');
	});
});
