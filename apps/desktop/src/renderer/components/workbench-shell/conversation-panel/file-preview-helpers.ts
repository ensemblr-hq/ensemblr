import type { TFunction } from 'i18next';

import { languageForFilePath } from '@/renderer/lib/language-from-path';
import type {
	ReadWorkspaceFileFailureCode,
	ReadWorkspaceFileResult,
} from '@/shared/ipc/contracts/workspace-files';
import { PREVIEW_PDF_MIME_TYPE } from '@/shared/preview-media';

/**
 * Builds an embeddable data URL for image payloads returned by file preview.
 * @param result - File-read result from the workspace preview IPC.
 * @returns An image data URL, or null when the result contains text content.
 */
export function imageSourceForPreview(
	result: ReadWorkspaceFileResult,
): string | null {
	if (
		result.contentEncoding !== 'base64' ||
		!result.mimeType?.startsWith('image/') ||
		!result.content
	) {
		return null;
	}

	return `data:${result.mimeType};base64,${result.content}`;
}

/**
 * The base64 body of a PDF the preview should hand to the embedded viewer.
 * Chromium refuses to navigate a frame to a `data:` URL, so the caller turns
 * this into a blob URL rather than embedding it inline the way an image is.
 * @param result - File-read result from the workspace preview IPC.
 * @returns The base64 PDF body, or null when the result is not a PDF.
 */
function pdfContentForPreview(result: ReadWorkspaceFileResult): string | null {
	if (
		result.contentEncoding !== 'base64' ||
		result.mimeType !== PREVIEW_PDF_MIME_TYPE ||
		!result.content
	) {
		return null;
	}

	return result.content;
}

/**
 * How the preview should render a read result: bytes the browser can render on
 * its own — an image, a PDF — beat every text mode, and a `.md` file shows its
 * formatted preview only when the toggle is on and it is not one of those.
 * @param filePath - The workspace-relative path being previewed.
 * @param result - File-read result from the workspace preview IPC.
 * @param markdownPreviewEnabled - Whether the formatted-markdown toggle is on.
 * @returns The image source and PDF body (each or null), and the markdown flags.
 */
export function resolvePreviewMode(
	filePath: string,
	result: ReadWorkspaceFileResult,
	markdownPreviewEnabled: boolean,
): {
	imageSource: string | null;
	isMarkdown: boolean;
	pdfContent: string | null;
	showFormattedPreview: boolean;
} {
	const imageSource = imageSourceForPreview(result);
	const pdfContent = pdfContentForPreview(result);
	const isMarkdown = languageForFilePath(filePath) === 'markdown';
	return {
		imageSource,
		isMarkdown,
		pdfContent,
		showFormattedPreview:
			isMarkdown && markdownPreviewEnabled && !imageSource && !pdfContent,
	};
}

/**
 * Short display name for the format a binary preview refused, read off the MIME
 * subtype so `.tif` and `.tiff` both name themselves TIFF.
 * @param mimeType - MIME type the read resolved for the path.
 * @returns The format name in caps, such as `TIFF` or `HEIC`.
 */
export function previewFormatLabel(mimeType: string): string {
	return mimeType
		.slice(mimeType.indexOf('/') + 1)
		.replace(/^x-/, '')
		.toUpperCase();
}

/**
 * Format a byte count as a B/KB/MB string.
 * @param sizeBytes - The size in bytes.
 * @returns The formatted, human-readable size.
 */
export function formatSizeBytes(sizeBytes: number): string {
	if (sizeBytes < 1024) {
		return `${sizeBytes} B`;
	}
	if (sizeBytes < 1024 * 1024) {
		return `${(sizeBytes / 1024).toFixed(1)} KB`;
	}
	return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Build a human-readable message for a workspace file read failure.
 * @param code - The read-failure code.
 * @param filePath - The path that failed to read.
 * @param t - Translator from the calling component, so the message follows the UI language.
 * @returns A user-facing explanation of the failure.
 */
export function describeReadFailure(
	code: ReadWorkspaceFileFailureCode,
	filePath: string,
	t: TFunction,
): string {
	switch (code) {
		case 'not-found':
			return t(
				'workbench:file-preview.failure.not-found',
				'{{filePath}} does not exist.',
				{
					filePath,
				},
			);
		case 'not-file':
			return t(
				'workbench:file-preview.failure.not-file',
				'{{filePath}} is a directory and cannot be previewed.',
				{ filePath },
			);
		case 'too-large':
			return t(
				'workbench:file-preview.failure.too-large',
				'{{filePath}} is too large to preview.',
				{ filePath },
			);
		case 'invalid-path':
			return t(
				'workbench:file-preview.failure.invalid-path',
				'{{filePath}} is not a path this preview can open.',
				{ filePath },
			);
		case 'invalid-cwd':
			return t(
				'workbench:file-preview.failure.invalid-cwd',
				'The workspace directory is unavailable.',
			);
		default:
			return t(
				'workbench:file-preview.failure.unreadable',
				'Could not read {{filePath}}.',
				{ filePath },
			);
	}
}
