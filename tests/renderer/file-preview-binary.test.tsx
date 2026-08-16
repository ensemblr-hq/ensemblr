// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ensemblrQueryKeys } from '../../src/renderer/api/ensemblr-queries';
import { previewFormatLabel } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-helpers';
import { FilePreviewPanel } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-panel';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config';
import type { ReadWorkspaceFileResult } from '../../src/shared/ipc/contracts/workspace-files';
import {
	createTestQueryClient,
	installEnsemblrApi,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

beforeEach(() => {
	installLocalStorage();
	installEnsemblrApi({
		getAppSettings: async () => DEFAULT_APP_SETTINGS,
		updateAppSettings: async () => DEFAULT_APP_SETTINGS,
	});
});

const workspaceCwd = '/workspace/ensemblr';

function renderBinaryPreview(
	filePath: string,
	result: Omit<ReadWorkspaceFileResult, 'path'>,
) {
	const client = createTestQueryClient();
	client.setQueryData(ensemblrQueryKeys.filePreview(workspaceCwd, filePath), {
		...result,
		path: filePath,
	});

	return renderWithProviders(
		<FilePreviewPanel
			filePath={filePath}
			workspaceCwd={workspaceCwd}
			workspaceId='workspace-1'
		/>,
		{ client },
	);
}

describe('FilePreviewBody — binary reads', () => {
	test('names an image format no engine decodes', () => {
		renderBinaryPreview('scans/page.tiff', {
			binaryReason: 'unsupported-image',
			contentEncoding: 'binary',
			mimeType: 'image/tiff',
			sizeBytes: 614_404,
		});

		expect(
			screen.getByText('TIFF images cannot be displayed here (600.0 KB).'),
		).toBeTruthy();
	});

	test('says which format a mislabeled image claimed to be', () => {
		renderBinaryPreview('assets/broken.webp', {
			binaryReason: 'invalid-image',
			contentEncoding: 'binary',
			mimeType: 'image/webp',
			sizeBytes: 8,
		});

		expect(
			screen.getByText('assets/broken.webp is not a valid WEBP image (8 B).'),
		).toBeTruthy();
	});

	test('calls a .pdf that is not a PDF a document, not an image', () => {
		renderBinaryPreview('docs/spec.pdf', {
			binaryReason: 'invalid-document',
			contentEncoding: 'binary',
			sizeBytes: 8,
		});

		const message = screen.getByText('docs/spec.pdf is not a valid PDF (8 B).');

		expect(message).toBeTruthy();
		expect(message.textContent).not.toContain('  ');
		expect(message.textContent).not.toContain('image');
	});

	test('falls back to a plain not-text notice for a non-image binary', () => {
		renderBinaryPreview('build/tool.bin', {
			binaryReason: 'not-text',
			contentEncoding: 'binary',
			sizeBytes: 8,
		});

		expect(
			screen.getByText(
				'build/tool.bin is not text and cannot be previewed (8 B).',
			),
		).toBeTruthy();
	});

	test('renders no code surface for bytes it refused', () => {
		const { container } = renderBinaryPreview('build/tool.bin', {
			binaryReason: 'not-text',
			contentEncoding: 'binary',
			sizeBytes: 8,
		});

		expect(container.querySelector('pre')).toBeNull();
		expect(screen.queryByRole('img')).toBeNull();
	});
});

describe('previewFormatLabel', () => {
	test('reads the format off the MIME subtype', () => {
		expect(previewFormatLabel('image/tiff')).toBe('TIFF');
		expect(previewFormatLabel('image/heic')).toBe('HEIC');
		expect(previewFormatLabel('image/jxl')).toBe('JXL');
	});

	test('strips the x- prefix legacy types carry', () => {
		expect(previewFormatLabel('image/x-icon')).toBe('ICON');
	});
});
