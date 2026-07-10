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

import { attachPastedFiles } from '../../src/renderer/lib/workbench/composer-attachments';

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
		savedRow('.context/images/x.png'),
	);
	writeWorkspaceFileAttachment.mockResolvedValue(
		savedRow('.context/attachments/x.svg'),
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
		expect(result.savedFiles).toHaveLength(1);
	});

	test('routes an SVG through the file write path so it is not rejected as an image', async () => {
		const svg = new File(['<svg></svg>'], 'diagram.svg', {
			type: 'image/svg+xml',
		});

		const result = await attachPastedFiles([svg], '/repo');

		expect(writeWorkspaceFileAttachment).toHaveBeenCalledTimes(1);
		expect(writeWorkspaceImageAttachment).not.toHaveBeenCalled();
		expect(result.error).toBeNull();
		expect(result.savedFiles).toHaveLength(1);
	});

	test('surfaces a write failure as an error while keeping earlier saves', async () => {
		writeWorkspaceFileAttachment.mockResolvedValueOnce({
			error: { code: 'write-failed', message: 'disk full' },
		});
		const doc = new File(['hi'], 'notes.txt', { type: 'text/plain' });

		const result = await attachPastedFiles([doc], '/repo');

		expect(result.error).toBe('disk full');
		expect(result.savedFiles).toHaveLength(0);
	});
});
