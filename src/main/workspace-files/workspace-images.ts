/**
 * What the workspace accepts as a raster image: the size ceiling and the
 * magic-byte signatures. Both the attachment store (validating a pasted payload
 * before persisting it) and the file preview (refusing to render bytes whose
 * extension lies, and budgeting the read) need the same answers, so they live
 * here rather than on either side where the two could drift apart.
 */

import path from 'node:path';

/**
 * Ceiling for image bytes held in memory — the cap on a pasted image the store
 * will persist, and on a workspace image the preview will decode.
 */
export const MAX_CONTEXT_IMAGE_BYTES = 10 * 1024 * 1024;

/** Safe file extension to persist for each accepted image MIME type. */
const IMAGE_EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
	'image/bmp': 'bmp',
	'image/gif': 'gif',
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/tiff': 'tiff',
	'image/webp': 'webp',
};

/** Leading-byte magic signatures expected for each supported image extension. */
const IMAGE_SIGNATURES_BY_EXTENSION: Readonly<
	Record<string, readonly (readonly number[])[]>
> = {
	bmp: [[0x42, 0x4d]],
	gif: [[0x47, 0x49, 0x46, 0x38]],
	jpg: [[0xff, 0xd8, 0xff]],
	png: [[0x89, 0x50, 0x4e, 0x47]],
	tiff: [
		[0x49, 0x49, 0x2a, 0x00],
		[0x4d, 0x4d, 0x00, 0x2a],
	],
	webp: [[0x52, 0x49, 0x46, 0x46]],
};

// WebP is a RIFF container, so the RIFF prefix alone also matches WAV/AVI; the
// `WEBP` fourcc at offset 8 disambiguates it from other RIFF payloads.
const WEBP_FOURCC = [0x57, 0x45, 0x42, 0x50] as const;
const WEBP_FOURCC_OFFSET = 8;

/**
 * Resolves a safe file extension for a pasted image MIME type.
 * @param mimeType - MIME type declared by the renderer.
 * @returns The extension to persist under, or null when the type is not accepted.
 */
export function extensionForImageMimeType(mimeType: string): string | null {
	return IMAGE_EXTENSION_BY_MIME_TYPE[mimeType.toLowerCase()] ?? null;
}

/**
 * Resolves the signature key for a file being previewed, normalizing `jpeg` to
 * `jpg` so both spellings validate against the same magic bytes.
 * @param filePath - Repo-relative path of the file being previewed.
 * @returns The signature key, or null when the extension has no known signature.
 */
export function signatureExtensionForPreview(filePath: string): string | null {
	const extension = path.extname(filePath).slice(1).toLowerCase();
	const normalized = extension === 'jpeg' ? 'jpg' : extension;
	return normalized in IMAGE_SIGNATURES_BY_EXTENSION ? normalized : null;
}

/**
 * Confirms decoded bytes begin with a magic signature valid for the declared
 * extension, so a mislabeled non-image cannot be persisted as one and then
 * announced to the agent as an inspectable image.
 * @param buffer - Decoded image bytes.
 * @param extension - Signature key returned by one of the resolvers above.
 * @returns True when the leading bytes match the declared format.
 */
export function imageSignatureMatches(
	buffer: Buffer,
	extension: string,
): boolean {
	const signatures = IMAGE_SIGNATURES_BY_EXTENSION[extension];
	if (!signatures) {
		return false;
	}
	const prefixMatches = signatures.some(
		(signature) =>
			buffer.length >= signature.length &&
			signature.every((byte, index) => buffer[index] === byte),
	);
	if (!prefixMatches) {
		return false;
	}
	if (extension === 'webp') {
		return WEBP_FOURCC.every(
			(byte, index) => buffer[WEBP_FOURCC_OFFSET + index] === byte,
		);
	}
	return prefixMatches;
}
