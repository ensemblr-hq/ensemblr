import { describe, expect, test } from 'vitest';

import {
	resolveOpenTargetPath,
	sanitizeOpenTargetPath,
} from '../../src/main/open-target/open-target-paths';

const WORKSPACE = '/repo/workspace';

describe('sanitizeOpenTargetPath', () => {
	test('returns undefined when no path is provided', () => {
		expect(sanitizeOpenTargetPath(undefined)).toBeUndefined();
		expect(sanitizeOpenTargetPath('')).toBeUndefined();
	});

	test('normalizes a safe relative path', () => {
		expect(sanitizeOpenTargetPath('src/app.ts')).toBe('src/app.ts');
		expect(sanitizeOpenTargetPath('./src/./app.ts')).toBe('src/app.ts');
	});

	test('rejects a relative path that climbs out of the workspace', () => {
		expect(sanitizeOpenTargetPath('..')).toBeNull();
		expect(sanitizeOpenTargetPath('../secrets')).toBeNull();
		expect(sanitizeOpenTargetPath('../../etc/passwd')).toBeNull();
	});

	test('passes an absolute path through so external previews can be opened', () => {
		expect(sanitizeOpenTargetPath('/tmp/scratch.md')).toBe('/tmp/scratch.md');
		expect(sanitizeOpenTargetPath('/tmp/./notes/../scratch.md')).toBe(
			'/tmp/scratch.md',
		);
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

	test('uses an absolute path as-is instead of joining it onto the workspace', () => {
		expect(
			resolveOpenTargetPath({
				kind: 'editor',
				relativePath: '/tmp/scratch.md',
				relativePathKind: 'file',
				workspacePath: WORKSPACE,
			}),
		).toBe('/tmp/scratch.md');
	});

	test('takes the parent of an absolute path for terminals and git GUIs', () => {
		expect(
			resolveOpenTargetPath({
				kind: 'terminal',
				relativePath: '/tmp/notes/scratch.md',
				relativePathKind: 'file',
				workspacePath: WORKSPACE,
			}),
		).toBe('/tmp/notes');
	});
});
