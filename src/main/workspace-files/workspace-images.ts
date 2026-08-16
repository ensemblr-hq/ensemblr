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
	'image/avif': 'avif',
	'image/bmp': 'bmp',
	'image/gif': 'gif',
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/tiff': 'tiff',
	'image/vnd.microsoft.icon': 'ico',
	'image/webp': 'webp',
	'image/x-icon': 'ico',
};

/**
 * What a file's leading bytes must look like for each supported extension,
 * modelled as the two shapes real formats take rather than as a bag of optional
 * fields — an entry declaring neither would match every payload, so the union
 * makes that unwritable.
 *
 * A `prefixes` entry matches alternative signatures from byte 0, optionally
 * pinned further in by `markers`: four-character tags whose every entry must
 * match, for a container whose prefix alone is ambiguous. A `brands` entry
 * instead reads an ISOBMFF `ftyp` box and accepts any listed brand.
 */
type ImageSignature =
	| { brands: readonly string[] }
	| {
			markers?: readonly { alternatives: readonly string[]; offset: number }[];
			prefixes: readonly (readonly number[])[];
	  };

/**
 * Magic-byte expectations per supported image extension. WebP is a RIFF
 * container whose prefix also matches WAV and AVI, and AVIF is an ISOBMFF box
 * whose leading four bytes are a length rather than a signature and whose `ftyp`
 * header it shares with HEIC and MP4 — so both are pinned by brand instead.
 */
const IMAGE_SIGNATURES_BY_EXTENSION: Readonly<Record<string, ImageSignature>> =
	{
		avif: { brands: ['avif', 'avis'] },
		bmp: { prefixes: [[0x42, 0x4d]] },
		gif: { prefixes: [[0x47, 0x49, 0x46, 0x38]] },
		ico: { prefixes: [[0x00, 0x00, 0x01, 0x00]] },
		jpg: { prefixes: [[0xff, 0xd8, 0xff]] },
		png: { prefixes: [[0x89, 0x50, 0x4e, 0x47]] },
		tiff: {
			prefixes: [
				[0x49, 0x49, 0x2a, 0x00],
				[0x4d, 0x4d, 0x00, 0x2a],
			],
		},
		webp: {
			markers: [{ alternatives: ['WEBP'], offset: 8 }],
			prefixes: [[0x52, 0x49, 0x46, 0x46]],
		},
	};

/** Extension spellings that validate against another extension's signature. */
const SIGNATURE_EXTENSION_ALIASES: Readonly<Record<string, string>> = {
	jpeg: 'jpg',
	tif: 'tiff',
};

/**
 * Resolves a safe file extension for a pasted image MIME type.
 * @param mimeType - MIME type declared by the renderer.
 * @returns The extension to persist under, or null when the type is not accepted.
 */
export function extensionForImageMimeType(mimeType: string): string | null {
	return IMAGE_EXTENSION_BY_MIME_TYPE[mimeType.toLowerCase()] ?? null;
}

/**
 * Resolves the signature key for a file being previewed, folding alternative
 * spellings such as `jpeg` and `tif` onto the key that owns their magic bytes.
 * @param filePath - Repo-relative path of the file being previewed.
 * @returns The signature key, or null when the extension has no known signature.
 */
export function signatureExtensionForPreview(filePath: string): string | null {
	const extension = path.extname(filePath).slice(1).toLowerCase();
	const normalized = SIGNATURE_EXTENSION_ALIASES[extension] ?? extension;
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
	const signature = IMAGE_SIGNATURES_BY_EXTENSION[extension];
	if (!signature) {
		return false;
	}
	if ('brands' in signature) {
		const declared = isobmffBrands(buffer);
		return signature.brands.some((brand) => declared.has(brand));
	}

	return (
		signature.prefixes.some((prefix) => bytesMatchAt(buffer, 0, prefix)) &&
		(signature.markers ?? []).every(({ alternatives, offset }) =>
			alternatives.some((tag) => bytesMatchAt(buffer, offset, asciiBytes(tag))),
		)
	);
}

/**
 * Byte layout of the ISOBMFF `ftyp` box every AVIF, HEIC, and MP4 opens with:
 * a big-endian box length, the `ftyp` tag, the major brand, a minor version,
 * then the compatible brands filling the rest of the box.
 */
const FTYP = {
	compatibleBrandsOffset: 16,
	majorBrandOffset: 8,
	markerOffset: 4,
	tagLength: 4,
} as const;

/**
 * Reads every brand an ISOBMFF payload declares — the major brand plus each
 * compatible brand. AVIF only requires `avif` to appear somewhere in that list,
 * so a file branded `mif1` with `avif` among its compatible brands is a valid
 * AVIF that pinning the major brand alone would reject.
 * @param buffer - Decoded file bytes.
 * @returns The declared brands, or an empty set when this is not an `ftyp` box.
 */
function isobmffBrands(buffer: Buffer): ReadonlySet<string> {
	const isFileTypeBox = bytesMatchAt(
		buffer,
		FTYP.markerOffset,
		asciiBytes('ftyp'),
	);
	if (!isFileTypeBox || buffer.length < FTYP.compatibleBrandsOffset) {
		return new Set();
	}
	const boxEnd = Math.min(buffer.readUInt32BE(0), buffer.length);
	const brands = new Set([
		buffer.toString(
			'latin1',
			FTYP.majorBrandOffset,
			FTYP.majorBrandOffset + FTYP.tagLength,
		),
	]);
	for (
		let offset = FTYP.compatibleBrandsOffset;
		offset + FTYP.tagLength <= boxEnd;
		offset += FTYP.tagLength
	) {
		brands.add(buffer.toString('latin1', offset, offset + FTYP.tagLength));
	}
	return brands;
}

/**
 * Compares a byte run against the buffer at a given offset, treating a buffer
 * too short to hold the run as a mismatch.
 * @param buffer - Decoded image bytes.
 * @param offset - Byte offset the run should start at.
 * @param expected - The bytes expected there.
 * @returns True when every expected byte is present at the offset.
 */
function bytesMatchAt(
	buffer: Buffer,
	offset: number,
	expected: readonly number[],
): boolean {
	return (
		buffer.length >= offset + expected.length &&
		expected.every((byte, index) => buffer[offset + index] === byte)
	);
}

/**
 * Converts a container brand tag to the bytes it occupies on disk.
 * @param tag - ASCII tag such as `WEBP` or `ftyp`.
 * @returns The tag's character codes.
 */
function asciiBytes(tag: string): readonly number[] {
	return [...tag].map((character) => character.charCodeAt(0));
}
