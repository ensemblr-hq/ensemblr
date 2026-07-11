/// <reference types="node" />

import { execFileSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createLocalCommandService } from '../../src/main/commands/local-command';
import { createListWorkspaceFilesService } from '../../src/main/workspace-files/list-workspace-files';

const tempDirs: string[] = [];

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
});

describe('createListWorkspaceFilesService.writeImageAttachment', () => {
	test('writes pasted images into .context/images as ignored workspace files', async () => {
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
		expect(file.path).toMatch(
			/^\.context\/images\/screenshot-1-\d+-[0-9a-f]{8}\.png$/,
		);
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
		expect(result.file?.path).toMatch(
			/^\.context\/images\/shot-\d+-[0-9a-f]{8}\.webp$/,
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
	test('writes pasted files into .context/attachments as ignored workspace files', async () => {
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
		expect(file.path).toMatch(
			/^\.context\/attachments\/quarterly-report-\d+-[0-9a-f]{8}\.pdf$/,
		);
		expect(readFileSync(path.join(cwd, file.path))).toEqual(bytes);
	});

	test('sniffs extensionless text payloads and saves them as .txt', async () => {
		const result = await workspaceFilesService().writeFileAttachment({
			contentBase64: Buffer.from('#!/bin/sh\necho hi\n').toString('base64'),
			name: 'Makefile',
			workspaceCwd: seedRepo(),
		});

		expect(result.file?.path).toMatch(
			/^\.context\/attachments\/makefile-\d+-[0-9a-f]{8}\.txt$/,
		);
	});

	test('falls back to a bin extension for extensionless binary payloads', async () => {
		const result = await workspaceFilesService().writeFileAttachment({
			contentBase64: Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]).toString(
				'base64',
			),
			name: 'blob',
			workspaceCwd: seedRepo(),
		});

		expect(result.file?.path).toMatch(
			/^\.context\/attachments\/blob-\d+-[0-9a-f]{8}\.bin$/,
		);
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
