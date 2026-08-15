/**
 * Browser-renderable image MIME types keyed by lowercase file extension. Main
 * reads it to decide when a workspace file read returns base64 image bytes; the
 * renderer reads it to decide when a path belongs in the image preview rather
 * than a source or diff surface. SVG is deliberately absent: it is markup, so it
 * reads and diffs as text.
 */
const PREVIEW_IMAGE_MIME_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
	avif: 'image/avif',
	bmp: 'image/bmp',
	gif: 'image/gif',
	ico: 'image/x-icon',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
};

/**
 * Image MIME types keyed by extension that no browser engine decodes, so the
 * preview names the format rather than embedding an `<img>` that renders broken.
 * They are still image files a user can click in the tree, and the difference
 * between "we know this is a TIFF and cannot show it" and "these bytes are not
 * text" is what keeps the preview from dumping the file as mojibake.
 */
const UNRENDERABLE_IMAGE_MIME_TYPE_BY_EXTENSION: Readonly<
	Record<string, string>
> = {
	heic: 'image/heic',
	heif: 'image/heif',
	jxl: 'image/jxl',
	tif: 'image/tiff',
	tiff: 'image/tiff',
};

/** Leading bytes sniffed when deciding whether a payload reads as text. */
const TEXT_SNIFF_BYTES = 8000;

/**
 * Lowercase extension of a path's file name, treating a leading-dot name such as
 * `.gitignore` as extensionless the way `path.extname` does.
 * @param filePath - Workspace-relative or absolute file path.
 * @returns The extension without its dot, or `''` when the name carries none.
 */
function fileNameExtension(filePath: string): string {
	const fileName = filePath.slice(filePath.lastIndexOf('/') + 1);
	const dotIndex = fileName.lastIndexOf('.');

	return dotIndex <= 0 ? '' : fileName.slice(dotIndex + 1).toLowerCase();
}

/**
 * Resolve the browser-previewable image MIME type a file path declares.
 * @param filePath - Workspace-relative file path.
 * @returns The image MIME type, or null when the extension is not previewable.
 */
export function previewImageMimeTypeForPath(filePath: string): string | null {
	return (
		PREVIEW_IMAGE_MIME_TYPE_BY_EXTENSION[fileNameExtension(filePath)] ?? null
	);
}

/**
 * Whether a path names an image the file preview can render inline.
 * @param filePath - Workspace-relative file path.
 * @returns True when the extension maps to a previewable image type.
 */
export function isPreviewableImagePath(filePath: string): boolean {
	return previewImageMimeTypeForPath(filePath) !== null;
}

/**
 * Resolve the image MIME type a path declares, whether or not a browser can
 * decode it. Wider than {@link previewImageMimeTypeForPath} on purpose: a
 * preview that cannot embed the bytes still names the format it refused.
 * @param filePath - Workspace-relative file path.
 * @returns The image MIME type, or null when the extension names no image.
 */
export function imageMimeTypeForPath(filePath: string): string | null {
	const extension = fileNameExtension(filePath);

	return (
		PREVIEW_IMAGE_MIME_TYPE_BY_EXTENSION[extension] ??
		UNRENDERABLE_IMAGE_MIME_TYPE_BY_EXTENSION[extension] ??
		null
	);
}

/**
 * Heuristically classify bytes as text the way git does: a NUL byte in the
 * leading sample means binary. An empty file counts as text — it has nothing in
 * it that could fail to decode.
 * @param bytes - Leading bytes of the file being classified.
 * @returns True when the sample carries no NUL byte.
 */
export function bytesLookLikeText(bytes: Uint8Array): boolean {
	return !bytes.subarray(0, TEXT_SNIFF_BYTES).includes(0);
}

/** MIME type of the one document format the preview embeds rather than decodes. */
export const PREVIEW_PDF_MIME_TYPE = 'application/pdf';

/** Leading bytes every PDF carries: `%PDF-`. */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

/**
 * Resolve the MIME type a file preview should hand the renderer as raw bytes
 * rather than as source text — an image it decodes, or a PDF it embeds. Kept
 * apart from {@link isPreviewableImagePath}, which answers the narrower "is this
 * an image" question the review and timeline surfaces ask.
 * @param filePath - Workspace-relative file path.
 * @returns The MIME type to return bytes under, or null to read it as text.
 */
export function previewEmbedMimeTypeForPath(filePath: string): string | null {
	if (fileNameExtension(filePath) === 'pdf') {
		return PREVIEW_PDF_MIME_TYPE;
	}
	return previewImageMimeTypeForPath(filePath);
}

/**
 * Confirm bytes really are a PDF, so a renamed executable cannot be handed to
 * the embedded viewer on the strength of its extension alone.
 * @param bytes - Leading bytes of the file being previewed.
 * @returns True when the payload starts with the PDF signature.
 */
export function pdfBytesLookValid(bytes: Uint8Array): boolean {
	if (bytes.length < PDF_SIGNATURE.length) {
		return false;
	}
	return PDF_SIGNATURE.every((byte, index) => bytes[index] === byte);
}
