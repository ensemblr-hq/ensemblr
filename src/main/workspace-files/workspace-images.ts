/**
 * What the workspace recognizes as a raster image: the size ceilings and the
 * magic-byte signatures. Both the attachment store (naming a pasted payload
 * after the format its bytes really carry) and the file preview (deciding what
 * to embed bytes as when their extension lies, and budgeting the read) need the
 * same answers, so they live here rather than on either side where the two
 * could drift apart. The video containers a mislabeled "GIF" often really is
 * are recognized here too, from the same `ftyp` box reader.
 */

import path from 'node:path';

import {
	bytesLookLikeText,
	PREVIEW_PDF_MIME_TYPE,
	pdfBytesLookValid,
	previewImageMimeTypeForExtension,
} from '../../shared/preview-media.ts';

/** Ceiling on a pasted image the attachment store will persist. */
export const MAX_CONTEXT_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Ceiling on an image or PDF the file preview reads to embed. Wider than the
 * paste cap because the composer references a file past that cap by path, and
 * an animated GIF or a screen recording routinely is one; it matches the
 * attachment store's hard ceiling, so anything the composer can hold, the
 * preview can show.
 */
export const MAX_PREVIEW_EMBED_BYTES = 50 * 1024 * 1024;

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

/**
 * The `ftyp` brands each video container the attachment store names a copy
 * after is recognized by. A "GIF" saved off a site that serves video is usually
 * one of these. QuickTime comes first because a `.mov` can list MP4 brands
 * among its compatible ones, while an MP4 does not list `qt  `.
 */
const VIDEO_BRANDS_BY_EXTENSION: readonly (readonly [
	string,
	readonly string[],
])[] = [
	['mov', ['qt  ']],
	[
		'mp4',
		[
			'avc1',
			'dash',
			'iso2',
			'iso4',
			'iso5',
			'iso6',
			'isom',
			'M4V ',
			'mp41',
			'mp42',
		],
	],
];

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
function signatureExtensionForPreview(filePath: string): string | null {
	return signatureKeyForExtension(path.extname(filePath).slice(1));
}

/**
 * Resolves the signature key a bare file extension validates against, folding
 * alternative spellings such as `jpeg` and `tif` onto the key that owns their
 * magic bytes.
 * @param extension - Extension without its dot, in any case.
 * @returns The signature key, or null when the extension has no known signature.
 */
export function signatureKeyForExtension(extension: string): string | null {
	const lowered = extension.toLowerCase();
	const normalized = SIGNATURE_EXTENSION_ALIASES[lowered] ?? lowered;
	return Object.hasOwn(IMAGE_SIGNATURES_BY_EXTENSION, normalized)
		? normalized
		: null;
}

/**
 * Names the raster format a payload's leading bytes carry, whatever its name or
 * declared type claims — a "GIF" saved off a site that serves WebP, a `.png`
 * that is really a JPEG. Callers gate this on the payload being binary: the BMP
 * signature is two printable bytes, so a text file could otherwise match it.
 * @param buffer - Decoded file bytes.
 * @returns The signature key, or null when no known signature matches.
 */
export function sniffImageSignature(buffer: Buffer): string | null {
	return (
		Object.keys(IMAGE_SIGNATURES_BY_EXTENSION).find((extension) =>
			imageSignatureMatches(buffer, extension),
		) ?? null
	);
}

/**
 * Names the video container a payload's `ftyp` box declares, so a clip saved as
 * `.gif` is stored as the MP4 or QuickTime file it really is rather than as an
 * opaque `.bin`. Only the attachment store asks: the preview embeds no video.
 * @param buffer - Decoded file bytes.
 * @returns The container's extension, or null when no known brand is declared.
 */
export function sniffVideoContainer(buffer: Buffer): string | null {
	const declared = isobmffBrands(buffer);
	const match = VIDEO_BRANDS_BY_EXTENSION.find(([, brands]) =>
		brands.some((brand) => declared.has(brand)),
	);
	return match ? match[0] : null;
}

/**
 * Confirms decoded bytes begin with a magic signature valid for the declared
 * extension, so a mislabeled payload is never persisted under an image
 * extension its bytes disprove and then announced to the agent as that image.
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

/**
 * Resolves the MIME type to embed a preview's bytes under. The type the
 * extension declares wins when the bytes confirm it; otherwise an image whose
 * bytes are some other browser-renderable format — a WebP saved as `.gif`, a
 * JPEG saved as `.png` — is embedded as what it really is rather than refused.
 * A `.pdf` that is not a PDF stays refused: there is no second format to try.
 * @param buffer - Decoded file contents.
 * @param filePath - Path whose extension declared the type.
 * @param declaredMimeType - The preview MIME type the extension declared.
 * @returns The MIME type to embed under, or null when the bytes are not embeddable.
 */
export function embeddableMimeType(
	buffer: Buffer,
	filePath: string,
	declaredMimeType: string,
): string | null {
	if (previewBytesLookValid(buffer, filePath, declaredMimeType)) {
		return declaredMimeType;
	}
	if (declaredMimeType === PREVIEW_PDF_MIME_TYPE || bytesLookLikeText(buffer)) {
		return null;
	}
	const sniffed = sniffImageSignature(buffer);
	return sniffed ? previewImageMimeTypeForExtension(sniffed) : null;
}

/**
 * Confirms a preview file's leading bytes match the type its extension declares,
 * so a mislabeled text or binary file falls back to the source view instead of a
 * broken `<img>` or an embedded viewer fed something that is not a document.
 * Extensions without a known prefix signature (e.g. the AVIF container) are
 * allowed through unvalidated.
 * @param buffer - Decoded file contents.
 * @param filePath - Workspace-relative file path whose extension declares the type.
 * @param mimeType - The preview MIME type resolved for that extension.
 * @returns True when the bytes are consistent with the declared type.
 */
function previewBytesLookValid(
	buffer: Buffer,
	filePath: string,
	mimeType: string,
): boolean {
	if (mimeType === PREVIEW_PDF_MIME_TYPE) {
		return pdfBytesLookValid(buffer);
	}
	const extension = signatureExtensionForPreview(filePath);
	if (!extension) {
		return true;
	}
	return imageSignatureMatches(buffer, extension);
}
