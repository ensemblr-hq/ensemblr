/// <reference types="node" />

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createLocalCommandService } from '../../src/main/commands/local-command';
import { createListWorkspaceFilesService } from '../../src/main/workspace-files/list-workspace-files';
import { resolvePreviewPath } from '../../src/main/workspace-files/workspace-paths';

const tempDirs: string[] = [];

/** The hash-folder name the attachment store derives for a payload. */
function sha256Prefix(buffer: Buffer): string {
	return createHash('sha256').update(buffer).digest('hex').slice(0, 6);
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { force: true, recursive: true });
		}
	}
});

function git(cwd: string, args: string[]): void {
	execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/**
 * Builds a temp repo with tracked files plus ignored entries: a small ignored
 * directory with nested contents (`.context/`), a larger ignored directory
 * (`node_modules/`), and an individually-ignored file (`debug.log`).
 */
function seedRepo(): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'ensemblr-list-files-'));
	tempDirs.push(dir);
	git(dir, ['init', '-b', 'main']);
	git(dir, ['config', 'user.email', 'test@ensemblr.dev']);
	git(dir, ['config', 'user.name', 'Ensemblr Test']);
	writeFileSync(
		path.join(dir, '.gitignore'),
		'.context/\nnode_modules/\n*.log\n',
	);
	writeFileSync(path.join(dir, 'README.md'), '# demo\n');
	mkdirSync(path.join(dir, 'src'));
	writeFileSync(path.join(dir, 'src', 'app.ts'), 'export const x = 1;\n');
	git(dir, ['add', '.']);
	git(dir, ['commit', '-m', 'init']);

	// Small ignored directory with nested contents — should be browsable.
	mkdirSync(path.join(dir, '.context', 'sessions'), { recursive: true });
	writeFileSync(path.join(dir, '.context', 'sessions', 'tab.md'), 'summary\n');

	// Larger ignored directory — should collapse past a small cap.
	for (const pkg of ['react', 'lodash', 'zod']) {
		mkdirSync(path.join(dir, 'node_modules', pkg), { recursive: true });
		writeFileSync(path.join(dir, 'node_modules', pkg, 'index.js'), '\n');
		writeFileSync(path.join(dir, 'node_modules', pkg, 'package.json'), '{}\n');
	}
	writeFileSync(path.join(dir, 'node_modules', 'react', '.DS_Store'), '\n');

	// Individually-ignored file.
	writeFileSync(path.join(dir, 'debug.log'), 'noise\n');

	// Untracked OS/system junk that must be hidden outright, not just dimmed.
	writeFileSync(path.join(dir, '.DS_Store'), '\n');
	writeFileSync(path.join(dir, 'src', '.DS_Store'), '\n');
	writeFileSync(path.join(dir, '._resource'), '\n');
	return dir;
}

function listFiles(cwd: string, ignoredRootMaxEntries?: number) {
	const service = createListWorkspaceFilesService({
		ignoredRootMaxEntries,
		localCommandService: createLocalCommandService(),
	});
	return service.list({ workspaceCwd: cwd });
}

function readDir(cwd: string, dirPath: string) {
	const service = createListWorkspaceFilesService({
		localCommandService: createLocalCommandService(),
	});
	return service.readDirectory({ path: dirPath, workspaceCwd: cwd });
}

function workspaceFilesService() {
	return createListWorkspaceFilesService({
		localCommandService: createLocalCommandService(),
	});
}

function readWorkspaceFile(cwd: string, filePath: string) {
	return workspaceFilesService().read({ path: filePath, workspaceCwd: cwd });
}

describe('createListWorkspaceFilesService.list', () => {
	test('enumerates ignored directory contents so they are browsable', async () => {
		const result = await listFiles(seedRepo());

		expect(result.error).toBeUndefined();
		const byPath = new Map(result.files.map((entry) => [entry.path, entry]));

		// Tracked entries are present and not dimmed.
		expect(byPath.get('README.md')?.isIgnored).toBeFalsy();
		expect(byPath.get('src')?.kind).toBe('directory');
		expect(byPath.get('src')?.isIgnored).toBeFalsy();
		expect(byPath.get('src/app.ts')?.isIgnored).toBeFalsy();

		// The ignored directory AND its nested contents are listed and dimmed,
		// so the user can expand it to see its files.
		expect(byPath.get('.context')).toMatchObject({
			isIgnored: true,
			kind: 'directory',
		});
		expect(byPath.get('.context/sessions')).toMatchObject({
			isIgnored: true,
			kind: 'directory',
		});
		expect(byPath.get('.context/sessions/tab.md')).toMatchObject({
			isIgnored: true,
			kind: 'file',
		});

		// An individually-ignored file is dimmed too.
		expect(byPath.get('debug.log')).toMatchObject({
			isIgnored: true,
			kind: 'file',
		});
	});

	test('collapses ignored directories larger than the cap', async () => {
		// node_modules holds ~10 entries; cap at 5 forces it to collapse while the
		// small .context directory still enumerates.
		const result = await listFiles(seedRepo(), 5);
		const byPath = new Map(result.files.map((entry) => [entry.path, entry]));

		expect(byPath.get('node_modules')).toMatchObject({
			isIgnored: true,
			kind: 'directory',
		});
		const nodeModulesChildren = result.files.filter((entry) =>
			entry.path.startsWith('node_modules/'),
		);
		expect(nodeModulesChildren).toHaveLength(0);

		// The small ignored directory is still fully enumerated.
		expect(byPath.get('.context/sessions/tab.md')).toMatchObject({
			isIgnored: true,
			kind: 'file',
		});
	});

	test('never surfaces the .git metadata directory', async () => {
		const result = await listFiles(seedRepo());

		const gitEntries = result.files.filter(
			(entry) => entry.path === '.git' || entry.path.startsWith('.git/'),
		);
		expect(gitEntries).toHaveLength(0);
	});

	test('hides .DS_Store and AppleDouble junk at any depth', async () => {
		const result = await listFiles(seedRepo());
		const paths = result.files.map((entry) => entry.path);

		expect(paths).not.toContain('.DS_Store');
		expect(paths).not.toContain('src/.DS_Store');
		expect(paths).not.toContain('._resource');
		// A real file in the same folder as junk still lists.
		expect(paths).toContain('src/app.ts');
	});
});

describe('createListWorkspaceFilesService.read', () => {
	test('reads text files as utf8 preview content', async () => {
		const result = await readWorkspaceFile(seedRepo(), 'README.md');

		expect(result.error).toBeUndefined();
		expect(result.content).toBe('# demo\n');
		expect(result.contentEncoding).toBe('utf8');
		expect(result.mimeType).toBeUndefined();
	});

	test('reads image files as base64 preview content with a browser MIME type', async () => {
		const cwd = seedRepo();
		const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
		writeFileSync(path.join(cwd, 'diagram.png'), bytes);

		const result = await readWorkspaceFile(cwd, 'diagram.png');

		expect(result.error).toBeUndefined();
		expect(result.content).toBe(bytes.toString('base64'));
		expect(result.contentEncoding).toBe('base64');
		expect(result.mimeType).toBe('image/png');
		expect(result.sizeBytes).toBe(bytes.length);
	});

	test('falls back to utf8 source when image bytes do not match the extension', async () => {
		const cwd = seedRepo();
		writeFileSync(path.join(cwd, 'not-really.png'), 'plain text, not a png\n');

		const result = await readWorkspaceFile(cwd, 'not-really.png');

		expect(result.error).toBeUndefined();
		expect(result.content).toBe('plain text, not a png\n');
		expect(result.contentEncoding).toBe('utf8');
		expect(result.mimeType).toBeUndefined();
	});

	test('reads a PDF as base64 so the preview can embed it', async () => {
		const cwd = seedRepo();
		const bytes = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'binary');
		writeFileSync(path.join(cwd, 'spec.pdf'), bytes);

		const result = await readWorkspaceFile(cwd, 'spec.pdf');

		expect(result.error).toBeUndefined();
		expect(result.content).toBe(bytes.toString('base64'));
		expect(result.contentEncoding).toBe('base64');
		expect(result.mimeType).toBe('application/pdf');
		expect(result.sizeBytes).toBe(bytes.length);
	});

	test('falls back to utf8 source when a .pdf does not carry the PDF signature', async () => {
		const cwd = seedRepo();
		writeFileSync(path.join(cwd, 'not-really.pdf'), 'plain text, not a pdf\n');

		const result = await readWorkspaceFile(cwd, 'not-really.pdf');

		expect(result.error).toBeUndefined();
		expect(result.content).toBe('plain text, not a pdf\n');
		expect(result.contentEncoding).toBe('utf8');
		expect(result.mimeType).toBeUndefined();
	});

	test('reads an .ico as base64 so the preview renders it as an image', async () => {
		const cwd = seedRepo();
		const bytes = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
		writeFileSync(path.join(cwd, 'favicon.ico'), bytes);

		const result = await readWorkspaceFile(cwd, 'favicon.ico');

		expect(result.error).toBeUndefined();
		expect(result.content).toBe(bytes.toString('base64'));
		expect(result.contentEncoding).toBe('base64');
		expect(result.mimeType).toBe('image/x-icon');
	});

	test('falls back to utf8 source when an .ico does not carry the icon signature', async () => {
		const cwd = seedRepo();
		writeFileSync(
			path.join(cwd, 'not-really.ico'),
			'plain text, not an icon\n',
		);

		const result = await readWorkspaceFile(cwd, 'not-really.ico');

		expect(result.error).toBeUndefined();
		expect(result.content).toBe('plain text, not an icon\n');
		expect(result.contentEncoding).toBe('utf8');
		expect(result.mimeType).toBeUndefined();
	});

	test('reads a file outside the workspace by absolute path', async () => {
		const cwd = seedRepo();
		const outside = mkdtempSync(path.join(tmpdir(), 'ensemblr-outside-'));
		tempDirs.push(outside);
		const outsidePath = path.join(outside, 'scratch.md');
		writeFileSync(outsidePath, '# written by an agent\n');

		const result = await readWorkspaceFile(cwd, outsidePath);

		expect(result.error).toBeUndefined();
		expect(result.content).toBe('# written by an agent\n');
		expect(result.contentEncoding).toBe('utf8');
		expect(result.isExternal).toBe(true);
		expect(result.path).toBe(outsidePath);
	});

	test('reads an image outside the workspace as base64', async () => {
		const cwd = seedRepo();
		const outside = mkdtempSync(path.join(tmpdir(), 'ensemblr-outside-'));
		tempDirs.push(outside);
		const outsidePath = path.join(outside, 'shot.png');
		const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
		writeFileSync(outsidePath, bytes);

		const result = await readWorkspaceFile(cwd, outsidePath);

		expect(result.error).toBeUndefined();
		expect(result.contentEncoding).toBe('base64');
		expect(result.mimeType).toBe('image/png');
		expect(result.isExternal).toBe(true);
	});

	test('reports an absolute path inside the workspace as relative and internal', async () => {
		const cwd = seedRepo();

		const result = await readWorkspaceFile(cwd, path.join(cwd, 'README.md'));

		expect(result.error).toBeUndefined();
		expect(result.content).toBe('# demo\n');
		expect(result.isExternal).toBe(false);
		expect(result.path).toBe('README.md');
	});

	test('reads a relative climb the same way it reads the absolute path it denotes', async () => {
		const cwd = seedRepo();
		const outside = mkdtempSync(path.join(tmpdir(), 'ensemblr-sibling-'));
		tempDirs.push(outside);
		const outsidePath = path.join(outside, 'notes.md');
		writeFileSync(outsidePath, '# sibling worktree\n');

		const climbed = await readWorkspaceFile(
			cwd,
			path.relative(cwd, outsidePath),
		);
		const absolute = await readWorkspaceFile(cwd, outsidePath);

		expect(climbed).toEqual(absolute);
		expect(climbed.error).toBeUndefined();
		expect(climbed.content).toBe('# sibling worktree\n');
		expect(climbed.isExternal).toBe(true);
		expect(climbed.path).toBe(outsidePath);
	});

	test('still refuses a symlink inside the workspace whose target escapes it', async () => {
		const cwd = seedRepo();
		const outside = mkdtempSync(path.join(tmpdir(), 'ensemblr-outside-'));
		tempDirs.push(outside);
		const secretPath = path.join(outside, 'secret.txt');
		writeFileSync(secretPath, 'do not leak\n');
		symlinkSync(secretPath, path.join(cwd, 'link.txt'));

		const result = await readWorkspaceFile(cwd, 'link.txt');

		expect(result.error?.code).toBe('invalid-path');
	});
});

describe('resolvePreviewPath', () => {
	test('expands a leading tilde against the home directory', () => {
		const resolved = resolvePreviewPath({
			pathValue: '~/.claude/plans/plan.md',
			workspaceCwd: '/repo',
		});

		expect(resolved.ok).toBe(true);
		if (!resolved.ok) {
			return;
		}
		expect(resolved.absolutePath).toBe(
			path.join(homedir(), '.claude/plans/plan.md'),
		);
		expect(resolved.scope).toBe('external');
	});

	test('normalizes an absolute path before deciding its scope', () => {
		const resolved = resolvePreviewPath({
			pathValue: '/repo/src/../README.md',
			workspaceCwd: '/repo',
		});

		expect(resolved).toEqual({
			absolutePath: '/repo/README.md',
			displayPath: 'README.md',
			ok: true,
			scope: 'workspace',
		});
	});

	test('gives a relative climb and its absolute form the same answer', () => {
		expect(
			resolvePreviewPath({
				pathValue: '../sibling/notes.md',
				workspaceCwd: '/repos/app',
			}),
		).toEqual(
			resolvePreviewPath({
				pathValue: '/repos/sibling/notes.md',
				workspaceCwd: '/repos/app',
			}),
		);
	});

	test('resolves a relative path against the workspace root', () => {
		expect(
			resolvePreviewPath({
				pathValue: './src/../README.md',
				workspaceCwd: '/repo',
			}),
		).toEqual({
			absolutePath: '/repo/README.md',
			displayPath: 'README.md',
			ok: true,
			scope: 'workspace',
		});
	});

	test('refuses an empty path', () => {
		expect(
			resolvePreviewPath({ pathValue: '   ', workspaceCwd: '/repo' }).ok,
		).toBe(false);
	});
});

describe('createListWorkspaceFilesService.writeImageAttachment', () => {
	test('writes pasted images into a content-addressed folder as ignored workspace files', async () => {
		const cwd = seedRepo();
		const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
		const result = await workspaceFilesService().writeImageAttachment({
			contentBase64: bytes.toString('base64'),
			mimeType: 'image/png',
			name: 'Screenshot 1.png',
			workspaceCwd: cwd,
		});

		expect(result.error).toBeUndefined();
		expect(result.file).toBeDefined();
		const file = result.file;
		if (!file) {
			throw new Error('Expected pasted image file entry.');
		}
		expect(file).toMatchObject({
			isIgnored: true,
			kind: 'file',
		});
		expect(file.path).toBe(
			`.context/attachments/${sha256Prefix(bytes)}/screenshot-1.png`,
		);
		expect(result.reused).toBe(false);
		expect(readFileSync(path.join(cwd, file.path))).toEqual(bytes);
	});

	test('rejects non-image clipboard payloads', async () => {
		const result = await workspaceFilesService().writeImageAttachment({
			contentBase64: Buffer.from('not an image').toString('base64'),
			mimeType: 'text/plain',
			workspaceCwd: seedRepo(),
		});

		expect(result.error?.code).toBe('invalid-image');
		expect(result.file).toBeUndefined();
	});

	test('rejects bytes whose signature does not match the declared image type', async () => {
		const result = await workspaceFilesService().writeImageAttachment({
			contentBase64: Buffer.from('definitely not a png').toString('base64'),
			mimeType: 'image/png',
			workspaceCwd: seedRepo(),
		});

		expect(result.error?.code).toBe('invalid-image');
		expect(result.file).toBeUndefined();
	});

	test('accepts a WEBP payload carrying the WEBP fourcc', async () => {
		const bytes = Buffer.concat([
			Buffer.from('RIFF'),
			Buffer.from([0x24, 0x00, 0x00, 0x00]),
			Buffer.from('WEBP'),
			Buffer.from('VP8 '),
		]);
		const result = await workspaceFilesService().writeImageAttachment({
			contentBase64: bytes.toString('base64'),
			mimeType: 'image/webp',
			name: 'shot.webp',
			workspaceCwd: seedRepo(),
		});

		expect(result.error).toBeUndefined();
		expect(result.file?.path).toBe(
			`.context/attachments/${sha256Prefix(bytes)}/shot.webp`,
		);
	});

	test('rejects a RIFF payload that is not WEBP (e.g. a WAV mislabeled as webp)', async () => {
		const wavBytes = Buffer.concat([
			Buffer.from('RIFF'),
			Buffer.from([0x24, 0x00, 0x00, 0x00]),
			Buffer.from('WAVE'),
		]);
		const result = await workspaceFilesService().writeImageAttachment({
			contentBase64: wavBytes.toString('base64'),
			mimeType: 'image/webp',
			workspaceCwd: seedRepo(),
		});

		expect(result.error?.code).toBe('invalid-image');
		expect(result.file).toBeUndefined();
	});

	test('rejects images larger than the attachment size limit', async () => {
		const oversized = Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47]),
			Buffer.alloc(10 * 1024 * 1024, 0x61),
		]);
		const result = await workspaceFilesService().writeImageAttachment({
			contentBase64: oversized.toString('base64'),
			mimeType: 'image/png',
			workspaceCwd: seedRepo(),
		});

		expect(result.error?.code).toBe('invalid-image');
		expect(result.sizeBytes).toBe(oversized.length);
		expect(result.file).toBeUndefined();
	});

	test('rejects a non-absolute workspace cwd', async () => {
		const result = await workspaceFilesService().writeImageAttachment({
			contentBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
			mimeType: 'image/png',
			workspaceCwd: 'relative/workspace',
		});

		expect(result.error?.code).toBe('invalid-cwd');
		expect(result.file).toBeUndefined();
	});
});

describe('createListWorkspaceFilesService.writeFileAttachment', () => {
	test('writes pasted files into a content-addressed folder as ignored workspace files', async () => {
		const cwd = seedRepo();
		const bytes = Buffer.from('%PDF-1.7 fake pdf body');
		const result = await workspaceFilesService().writeFileAttachment({
			contentBase64: bytes.toString('base64'),
			name: 'Quarterly Report.pdf',
			workspaceCwd: cwd,
		});

		expect(result.error).toBeUndefined();
		const file = result.file;
		if (!file) {
			throw new Error('Expected pasted attachment file entry.');
		}
		expect(file).toMatchObject({ isIgnored: true, kind: 'file' });
		expect(file.path).toBe(
			`.context/attachments/${sha256Prefix(bytes)}/quarterly-report.pdf`,
		);
		expect(result.reused).toBe(false);
		expect(readFileSync(path.join(cwd, file.path))).toEqual(bytes);
	});

	test('sniffs extensionless text payloads and saves them as .txt', async () => {
		const bytes = Buffer.from('#!/bin/sh\necho hi\n');
		const result = await workspaceFilesService().writeFileAttachment({
			contentBase64: bytes.toString('base64'),
			name: 'Makefile',
			workspaceCwd: seedRepo(),
		});

		expect(result.file?.path).toBe(
			`.context/attachments/${sha256Prefix(bytes)}/makefile.txt`,
		);
	});

	test('falls back to a bin extension for extensionless binary payloads', async () => {
		const bytes = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]);
		const result = await workspaceFilesService().writeFileAttachment({
			contentBase64: bytes.toString('base64'),
			name: 'blob',
			workspaceCwd: seedRepo(),
		});

		expect(result.file?.path).toBe(
			`.context/attachments/${sha256Prefix(bytes)}/blob.bin`,
		);
	});

	test('reuses an identical payload instead of writing a second copy', async () => {
		const cwd = seedRepo();
		const bytes = Buffer.from('%PDF-1.7 the very same bytes');
		const request = {
			contentBase64: bytes.toString('base64'),
			name: 'report.pdf',
			workspaceCwd: cwd,
		};
		const service = workspaceFilesService();

		const first = await service.writeFileAttachment(request);
		const second = await service.writeFileAttachment(request);

		expect(first.reused).toBe(false);
		expect(second.reused).toBe(true);
		expect(second.file?.path).toBe(first.file?.path);
		expect(
			readdirSync(path.join(cwd, path.dirname(first.file?.path ?? ''))),
		).toEqual(['report.pdf']);
	});

	test('shares one copy of the bytes when the same payload arrives under a second name', async () => {
		const cwd = seedRepo();
		const bytes = Buffer.from('identical bytes, two names');
		const service = workspaceFilesService();

		const first = await service.writeFileAttachment({
			contentBase64: bytes.toString('base64'),
			name: 'first.txt',
			workspaceCwd: cwd,
		});
		const second = await service.writeFileAttachment({
			contentBase64: bytes.toString('base64'),
			name: 'second.txt',
			workspaceCwd: cwd,
		});

		const hashDir = `.context/attachments/${sha256Prefix(bytes)}`;
		expect(first.file?.path).toBe(`${hashDir}/first.txt`);
		expect(second.file?.path).toBe(`${hashDir}/second.txt`);
		expect(readFileSync(path.join(cwd, `${hashDir}/second.txt`))).toEqual(
			bytes,
		);
		// A hardlink, not a second copy: both names point at one inode.
		expect(statSync(path.join(cwd, `${hashDir}/first.txt`)).ino).toBe(
			statSync(path.join(cwd, `${hashDir}/second.txt`)).ino,
		);
	});

	test('keeps different payloads that share a name in separate folders', async () => {
		const cwd = seedRepo();
		const service = workspaceFilesService();
		const first = Buffer.from('one screenshot');
		const second = Buffer.from('a different screenshot');

		const firstResult = await service.writeFileAttachment({
			contentBase64: first.toString('base64'),
			name: 'shot.png',
			workspaceCwd: cwd,
		});
		const secondResult = await service.writeFileAttachment({
			contentBase64: second.toString('base64'),
			name: 'shot.png',
			workspaceCwd: cwd,
		});

		expect(firstResult.file?.path).not.toBe(secondResult.file?.path);
		expect(readFileSync(path.join(cwd, firstResult.file?.path ?? ''))).toEqual(
			first,
		);
		expect(readFileSync(path.join(cwd, secondResult.file?.path ?? ''))).toEqual(
			second,
		);
	});

	test('writes one file when the same payload is attached concurrently', async () => {
		const cwd = seedRepo();
		const bytes = Buffer.from('raced attachment payload');
		const service = workspaceFilesService();
		const request = {
			contentBase64: bytes.toString('base64'),
			name: 'raced.txt',
			workspaceCwd: cwd,
		};

		const results = await Promise.all([
			service.writeFileAttachment(request),
			service.writeFileAttachment(request),
			service.writeFileAttachment(request),
		]);

		const hashDir = `.context/attachments/${sha256Prefix(bytes)}`;
		for (const result of results) {
			expect(result.error).toBeUndefined();
			expect(result.file?.path).toBe(`${hashDir}/raced.txt`);
		}
		expect(readdirSync(path.join(cwd, hashDir))).toEqual(['raced.txt']);
	});

	test('rejects an undecodable base64 payload', async () => {
		const result = await workspaceFilesService().writeFileAttachment({
			contentBase64: '@@not base64@@',
			name: 'note.txt',
			workspaceCwd: seedRepo(),
		});

		expect(result.error?.code).toBe('invalid-attachment');
		expect(result.file).toBeUndefined();
	});

	test('rejects attachments larger than the hard ceiling', async () => {
		const oversized = Buffer.alloc(50 * 1024 * 1024 + 1, 0x61);
		const result = await workspaceFilesService().writeFileAttachment({
			contentBase64: oversized.toString('base64'),
			name: 'huge.bin',
			workspaceCwd: seedRepo(),
		});

		expect(result.error?.code).toBe('too-large');
		expect(result.sizeBytes).toBe(oversized.length);
		expect(result.file).toBeUndefined();
	});

	test('rejects a non-absolute workspace cwd', async () => {
		const result = await workspaceFilesService().writeFileAttachment({
			contentBase64: Buffer.from('data').toString('base64'),
			name: 'note.txt',
			workspaceCwd: 'relative/workspace',
		});

		expect(result.error?.code).toBe('invalid-cwd');
		expect(result.file).toBeUndefined();
	});
});

describe('createListWorkspaceFilesService.readDirectory', () => {
	test('reads a single directory level, tagging children ignored', async () => {
		const result = await readDir(seedRepo(), 'node_modules');

		expect(result.error).toBeUndefined();
		const byPath = new Map(result.entries.map((entry) => [entry.path, entry]));

		// Immediate children only — the package dirs, each dimmed.
		expect(byPath.get('node_modules/react')).toMatchObject({
			isIgnored: true,
			kind: 'directory',
		});
		expect(byPath.get('node_modules/lodash')?.kind).toBe('directory');
		// Not recursive: deeper files load on their own expand.
		expect(byPath.has('node_modules/react/index.js')).toBe(false);
	});

	test('reads nested ignored files on the next level', async () => {
		const result = await readDir(seedRepo(), 'node_modules/react');
		const paths = result.entries.map((entry) => entry.path);

		expect(paths).toContain('node_modules/react/index.js');
		expect(paths).toContain('node_modules/react/package.json');
		expect(result.entries.every((entry) => entry.isIgnored)).toBe(true);
		// System junk stays hidden even inside an ignored directory.
		expect(paths).not.toContain('node_modules/react/.DS_Store');
	});

	test('rejects a path that escapes the workspace', async () => {
		const result = await readDir(seedRepo(), '../../etc');

		expect(result.error?.code).toBe('invalid-path');
		expect(result.entries).toHaveLength(0);
	});

	test('errors when the path is a file, not a directory', async () => {
		const result = await readDir(seedRepo(), 'README.md');

		expect(result.error?.code).toBe('not-directory');
	});
});
