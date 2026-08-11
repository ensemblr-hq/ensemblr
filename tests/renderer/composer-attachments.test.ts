// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type {
	WriteWorkspaceFileAttachmentResult,
	WriteWorkspaceImageAttachmentResult,
} from '../../src/shared/ipc/contracts/workspace-files';

const writeWorkspaceImageAttachment =
	vi.fn<() => Promise<WriteWorkspaceImageAttachmentResult>>();
const writeWorkspaceFileAttachment =
	vi.fn<() => Promise<WriteWorkspaceFileAttachmentResult>>();
const getPathForFile = vi.fn<(file: File) => string>();

vi.mock('@/renderer/api/ensemblr-queries', () => ({
	getPathForFile: (file: File) => getPathForFile(file),
	writeWorkspaceFileAttachment: () => writeWorkspaceFileAttachment(),
	writeWorkspaceImageAttachment: () => writeWorkspaceImageAttachment(),
}));

import {
	attachPastedFiles,
	attachPastedText,
} from '../../src/renderer/lib/workbench/composer-attachments';

function savedRow(path: string) {
	return {
		file: {
			isIgnored: true as const,
			kind: 'file' as const,
			name: path.split('/').pop() ?? path,
			path,
		},
	};
}

beforeEach(() => {
	writeWorkspaceImageAttachment.mockReset();
	writeWorkspaceFileAttachment.mockReset();
	getPathForFile.mockReset();
	writeWorkspaceImageAttachment.mockResolvedValue(
		savedRow('.context/attachments/aa11bb/x.png'),
	);
	writeWorkspaceFileAttachment.mockResolvedValue(
		savedRow('.context/attachments/cc22dd/x.svg'),
	);
});

describe('attachPastedFiles', () => {
	test('routes a raster image through the image write path', async () => {
		const png = new File([new Uint8Array([0x89, 0x50])], 'shot.png', {
			type: 'image/png',
		});

		const result = await attachPastedFiles([png], '/repo');

		expect(writeWorkspaceImageAttachment).toHaveBeenCalledTimes(1);
		expect(writeWorkspaceFileAttachment).not.toHaveBeenCalled();
		expect(result.error).toBeNull();
		expect(result.attachments).toHaveLength(1);
	});

	test('routes an SVG through the file write path so it is not rejected as an image', async () => {
		const svg = new File(['<svg></svg>'], 'diagram.svg', {
			type: 'image/svg+xml',
		});

		const result = await attachPastedFiles([svg], '/repo');

		expect(writeWorkspaceFileAttachment).toHaveBeenCalledTimes(1);
		expect(writeWorkspaceImageAttachment).not.toHaveBeenCalled();
		expect(result.error).toBeNull();
		expect(result.attachments).toHaveLength(1);
	});

	test('surfaces a write failure as an error while keeping earlier saves', async () => {
		writeWorkspaceFileAttachment.mockResolvedValueOnce({
			error: { code: 'write-failed', message: 'disk full' },
		});
		const doc = new File(['hi'], 'notes.txt', { type: 'text/plain' });

		const result = await attachPastedFiles([doc], '/repo');

		expect(result.error).toBe('disk full');
		expect(result.attachments).toHaveLength(0);
	});
});

describe('attachPastedText', () => {
	beforeEach(() => {
		writeWorkspaceFileAttachment.mockResolvedValue(
			savedRow('.context/attachments/ee33ff/pasted-text.txt'),
		);
	});

	test('persists the paste and carries a capped preview plus its line count', async () => {
		const text = `${'x'.repeat(300)}\nsecond\nthird`;

		const attachment = await attachPastedText(text, '/repo');

		expect(writeWorkspaceFileAttachment).toHaveBeenCalledTimes(1);
		expect(attachment).toMatchObject({
			id: 'wsfile:.context/attachments/ee33ff/pasted-text.txt',
			kind: 'pasted-text',
			label: 'pasted-text.txt',
			lineCount: 3,
			path: '.context/attachments/ee33ff/pasted-text.txt',
		});
		if (attachment.kind !== 'pasted-text') {
			throw new Error('Expected a pasted-text attachment.');
		}
		expect(attachment.preview).toHaveLength(240);
	});

	test('drops leading blank lines so the preview opens on real content', async () => {
		const attachment = await attachPastedText('\n\n  \nreal content', '/repo');

		if (attachment.kind !== 'pasted-text') {
			throw new Error('Expected a pasted-text attachment.');
		}
		expect(attachment.preview).toBe('real content');
	});

	test('propagates a write failure so the caller can fall back to inline text', async () => {
		writeWorkspaceFileAttachment.mockResolvedValueOnce({
			error: { code: 'write-failed', message: 'disk full' },
		});

		await expect(attachPastedText('a long paste', '/repo')).rejects.toThrow(
			'disk full',
		);
	});

	// The store is content-addressed, so the same bytes come back under the same
	// id — which is what lets the editor refuse a duplicate chip for a paste the
	// draft already holds.
	test('gives the same paste the same id however often it is stored', async () => {
		const first = await attachPastedText('same paste', '/repo');
		const second = await attachPastedText('same paste', '/repo');

		expect(second.id).toBe(first.id);
	});
});
