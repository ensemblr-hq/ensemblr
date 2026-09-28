/// <reference types="node" />

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createLocalCommandService } from '../../src/main/commands/local-command';
import { createListWorkspaceFilesService } from '../../src/main/workspace-files/list-workspace-files';

const tempDirs: string[] = [];

const GIF_BYTES = Buffer.from(
	'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
	'base64',
);
const PNG_BYTES = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const WEBP_BYTES = Buffer.concat([
	Buffer.from('RIFF'),
	Buffer.from([0x24, 0x00, 0x00, 0x00]),
	Buffer.from('WEBP'),
	Buffer.from('VP8 '),
	Buffer.from([0x00, 0x00, 0x00, 0x00]),
]);
const MP4_BYTES = Buffer.concat([
	Buffer.from([0x00, 0x00, 0x00, 0x18]),
	Buffer.from('ftypisom'),
	Buffer.from([0x00, 0x00, 0x02, 0x00]),
	Buffer.from('isomiso2'),
]);

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { force: true, recursive: true });
		}
	}
});

function workspace(): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'ensemblr-attachment-formats-'));
	tempDirs.push(dir);
	return dir;
}

function service() {
	return createListWorkspaceFilesService({
		localCommandService: createLocalCommandService(),
	});
}

function storedPath(bytes: Buffer, name: string): string {
	const prefix = createHash('sha256').update(bytes).digest('hex').slice(0, 6);
	return `.context/attachments/${prefix}/${name}`;
}

function attachImage(bytes: Buffer, mimeType: string, name?: string) {
	return service().writeImageAttachment({
		contentBase64: bytes.toString('base64'),
		mimeType,
		...(name === undefined ? {} : { name }),
		workspaceCwd: workspace(),
	});
}

function attachFile(bytes: Buffer, name: string) {
	return service().writeFileAttachment({
		contentBase64: bytes.toString('base64'),
		name,
		workspaceCwd: workspace(),
	});
}

describe('image attachments', () => {
	test('stores a GIF under its own extension', async () => {
		const result = await attachImage(
			GIF_BYTES,
			'image/gif',
			'Party Parrot.gif',
		);

		expect(result.error).toBeUndefined();
		expect(result.file?.path).toBe(storedPath(GIF_BYTES, 'party-parrot.gif'));
	});

	test('renames a "GIF" whose bytes are really a WebP after what it is', async () => {
		const result = await attachImage(WEBP_BYTES, 'image/gif', 'reaction.gif');

		expect(result.error).toBeUndefined();
		expect(result.file?.path).toBe(storedPath(WEBP_BYTES, 'reaction.webp'));
	});

	test('stores an animated PNG the browser reports as image/apng as a PNG', async () => {
		const result = await attachImage(PNG_BYTES, 'image/apng', 'spinner.apng');

		expect(result.error).toBeUndefined();
		expect(result.file?.path).toBe(storedPath(PNG_BYTES, 'spinner.png'));
	});

	test('keeps an image format it has no signature for under its own name', async () => {
		const heic = Buffer.concat([
			Buffer.from([0x00, 0x00, 0x00, 0x18]),
			Buffer.from('ftypheic'),
			Buffer.from([0x00, 0x00, 0x00, 0x00]),
			Buffer.from('mif1heic'),
		]);
		const result = await attachImage(heic, 'image/heic', 'IMG_0001.HEIC');

		expect(result.error).toBeUndefined();
		expect(result.file?.path).toBe(storedPath(heic, 'img_0001.heic'));
	});

	test('stores a payload that is not an image rather than refusing it', async () => {
		const bytes = Buffer.from('definitely not a png');
		const result = await attachImage(bytes, 'image/png');

		expect(result.error).toBeUndefined();
		expect(result.file?.path).toBe(storedPath(bytes, 'pasted-image.txt'));
	});

	test('drops an image extension the bytes disprove', async () => {
		const result = await attachImage(MP4_BYTES, 'image/gif', 'clip.gif');

		expect(result.error).toBeUndefined();
		expect(result.file?.path).toBe(storedPath(MP4_BYTES, 'clip.bin'));
	});
});

describe('file attachments', () => {
	test('keeps a GIF dropped without a MIME type under its own extension', async () => {
		const result = await attachFile(GIF_BYTES, 'loop.gif');

		expect(result.error).toBeUndefined();
		expect(result.file?.path).toBe(storedPath(GIF_BYTES, 'loop.gif'));
	});

	test('names a ".gif" holding PNG bytes after the format it really is', async () => {
		const result = await attachFile(PNG_BYTES, 'shot.gif');

		expect(result.file?.path).toBe(storedPath(PNG_BYTES, 'shot.png'));
	});

	test('names an extensionless image after the format its bytes carry', async () => {
		const result = await attachFile(GIF_BYTES, 'clipboard');

		expect(result.file?.path).toBe(storedPath(GIF_BYTES, 'clipboard.gif'));
	});

	test('leaves a non-image extension alone whatever the bytes start with', async () => {
		const bytes = Buffer.from('BM is also how this note starts\n');
		const result = await attachFile(bytes, 'notes.md');

		expect(result.file?.path).toBe(storedPath(bytes, 'notes.md'));
	});

	test('stores an empty file', async () => {
		const cwd = workspace();
		const result = await service().writeFileAttachment({
			contentBase64: '',
			name: '__init__.py',
			workspaceCwd: cwd,
		});

		expect(result.error).toBeUndefined();
		const file = result.file;
		expect(file?.path).toBe(storedPath(Buffer.alloc(0), '__init__.py'));
		expect(readFileSync(path.join(cwd, file?.path ?? '')).length).toBe(0);
	});
});

describe('image previews', () => {
	function preview(cwd: string, filePath: string) {
		return service().read({ path: filePath, workspaceCwd: cwd });
	}

	test('embeds an animated GIF larger than the attachment image cap', async () => {
		const cwd = workspace();
		const bytes = Buffer.concat([GIF_BYTES, Buffer.alloc(12 * 1024 * 1024)]);
		writeFileSync(path.join(cwd, 'recording.gif'), bytes);

		const result = await preview(cwd, 'recording.gif');

		expect(result.error).toBeUndefined();
		expect(result.contentEncoding).toBe('base64');
		expect(result.mimeType).toBe('image/gif');
		expect(result.sizeBytes).toBe(bytes.length);
	});

	test('embeds a ".gif" holding WebP bytes under the format it really is', async () => {
		const cwd = workspace();
		writeFileSync(path.join(cwd, 'reaction.gif'), WEBP_BYTES);

		const result = await preview(cwd, 'reaction.gif');

		expect(result.contentEncoding).toBe('base64');
		expect(result.mimeType).toBe('image/webp');
		expect(result.content).toBe(WEBP_BYTES.toString('base64'));
	});

	test('still refuses an image past the preview ceiling on size', async () => {
		const cwd = workspace();
		const bytes = Buffer.concat([
			GIF_BYTES,
			Buffer.alloc(50 * 1024 * 1024 + 1),
		]);
		writeFileSync(path.join(cwd, 'huge.gif'), bytes);

		const result = await preview(cwd, 'huge.gif');

		expect(result.error?.code).toBe('too-large');
	});
});
