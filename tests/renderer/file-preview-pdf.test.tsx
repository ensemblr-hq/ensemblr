// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { resolvePreviewMode } from '@/renderer/components/workbench-shell/conversation-panel/file-preview-helpers';
import { usePdfObjectUrl } from '@/renderer/hooks/workbench-shell/conversation-panel/use-pdf-object-url';
import type { ReadWorkspaceFileResult } from '@/shared/ipc/contracts/workspace-files';

const PDF_BASE64 = btoa('%PDF-1.7\nstub');
const PDF_PATH = '.context/attachments/facebe/cv.pdf';

function pdfResult(): ReadWorkspaceFileResult {
	return {
		content: PDF_BASE64,
		contentEncoding: 'base64',
		mimeType: 'application/pdf',
		path: PDF_PATH,
		sizeBytes: 13,
	};
}

describe('resolvePreviewMode — PDF', () => {
	it('hands back the PDF body rather than an image source', () => {
		const mode = resolvePreviewMode(PDF_PATH, pdfResult(), true);

		expect(mode.pdfContent).toBe(PDF_BASE64);
		expect(mode.imageSource).toBeNull();
	});

	it('keeps an image on the image path', () => {
		const mode = resolvePreviewMode(
			'assets/logo.png',
			{
				content: 'AAAA',
				contentEncoding: 'base64',
				mimeType: 'image/png',
				path: 'assets/logo.png',
			},
			true,
		);

		expect(mode.imageSource).toBe('data:image/png;base64,AAAA');
		expect(mode.pdfContent).toBeNull();
	});

	it('refuses a PDF the main process returned as text, so bytes never leak', () => {
		const mode = resolvePreviewMode(
			PDF_PATH,
			{ content: '%PDF-1.7', contentEncoding: 'utf8', path: PDF_PATH },
			true,
		);

		expect(mode.pdfContent).toBeNull();
	});

	it('a markdown file read as text still formats', () => {
		const mode = resolvePreviewMode(
			'README.md',
			{ content: '# hi', contentEncoding: 'utf8', path: 'README.md' },
			true,
		);

		expect(mode.pdfContent).toBeNull();
		expect(mode.showFormattedPreview).toBe(true);
	});
});

describe('usePdfObjectUrl', () => {
	it('turns the base64 body into a blob URL the viewer can load', async () => {
		const { result } = renderHook(() => usePdfObjectUrl(PDF_BASE64));

		await waitFor(() => {
			expect(result.current).toMatch(/^blob:/);
		});
	});

	it('holds nothing when the file is not a PDF', () => {
		const { result } = renderHook(() => usePdfObjectUrl(null));

		expect(result.current).toBeNull();
	});

	it('revokes the URL when the preview moves on', async () => {
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		const { result, unmount } = renderHook(() => usePdfObjectUrl(PDF_BASE64));
		await waitFor(() => {
			expect(result.current).toMatch(/^blob:/);
		});
		const created = result.current;

		unmount();

		expect(revoke).toHaveBeenCalledWith(created);
		revoke.mockRestore();
	});
});
