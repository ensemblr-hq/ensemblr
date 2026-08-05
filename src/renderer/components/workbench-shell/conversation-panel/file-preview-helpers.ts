import { languageForFilePath } from '@/renderer/lib/language-from-path';
import type { ReadWorkspaceFileResult } from '@/shared/ipc/contracts/workspace-files';

/**
 * Builds an embeddable data URL for image payloads returned by file preview.
 * @param result - File-read result from the workspace preview IPC.
 * @returns An image data URL, or null when the result contains text content.
 */
function imageSourceForPreview(result: ReadWorkspaceFileResult): string | null {
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
 * How the preview should render a read result: an embeddable image beats every
 * text mode, and a `.md` file shows its formatted preview only when the toggle
 * is on and it is not an image.
 * @param filePath - The workspace-relative path being previewed.
 * @param result - File-read result from the workspace preview IPC.
 * @param markdownPreviewEnabled - Whether the formatted-markdown toggle is on.
 * @returns The image source (or null), and the markdown/formatted-preview flags.
 */
export function resolvePreviewMode(
	filePath: string,
	result: ReadWorkspaceFileResult,
	markdownPreviewEnabled: boolean,
): {
	imageSource: string | null;
	isMarkdown: boolean;
	showFormattedPreview: boolean;
} {
	const imageSource = imageSourceForPreview(result);
	const isMarkdown = languageForFilePath(filePath) === 'markdown';
	return {
		imageSource,
		isMarkdown,
		showFormattedPreview: isMarkdown && markdownPreviewEnabled && !imageSource,
	};
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
