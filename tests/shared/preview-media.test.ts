import { describe, expect, test } from 'vitest';

import {
	bytesLookLikeText,
	imageMimeTypeForPath,
	isPreviewableImagePath,
	pdfBytesLookValid,
	previewEmbedMimeTypeForPath,
	previewImageMimeTypeForPath,
} from '@/shared/preview-media';

describe('previewImageMimeTypeForPath', () => {
	test('maps every previewable extension to its browser MIME type', () => {
		expect(previewImageMimeTypeForPath('assets/logo.png')).toBe('image/png');
		expect(previewImageMimeTypeForPath('assets/photo.jpg')).toBe('image/jpeg');
		expect(previewImageMimeTypeForPath('assets/photo.jpeg')).toBe('image/jpeg');
		expect(previewImageMimeTypeForPath('assets/loop.gif')).toBe('image/gif');
		expect(previewImageMimeTypeForPath('assets/shot.webp')).toBe('image/webp');
		expect(previewImageMimeTypeForPath('assets/shot.avif')).toBe('image/avif');
		expect(previewImageMimeTypeForPath('assets/old.bmp')).toBe('image/bmp');
		expect(previewImageMimeTypeForPath('assets/favicon.ico')).toBe(
			'image/x-icon',
		);
	});

	test('matches the extension case-insensitively', () => {
		expect(previewImageMimeTypeForPath('assets/LOGO.PNG')).toBe('image/png');
	});

	test('returns null for source files and unsupported image formats', () => {
		expect(previewImageMimeTypeForPath('src/main/index.ts')).toBeNull();
		expect(previewImageMimeTypeForPath('assets/icon.svg')).toBeNull();
		expect(previewImageMimeTypeForPath('assets/scan.tiff')).toBeNull();
	});

	test('treats a dotfile name as extensionless', () => {
		expect(previewImageMimeTypeForPath('.png')).toBeNull();
		expect(previewImageMimeTypeForPath('src/.gitignore')).toBeNull();
	});

	test('ignores dots in directory names', () => {
		expect(previewImageMimeTypeForPath('v1.2/README')).toBeNull();
		expect(previewImageMimeTypeForPath('v1.2/logo.png')).toBe('image/png');
	});
});

describe('isPreviewableImagePath', () => {
	test('answers true only for paths the image preview can render', () => {
		expect(isPreviewableImagePath('docs/diagram.png')).toBe(true);
		expect(isPreviewableImagePath('assets/shot.webp')).toBe(true);
		expect(isPreviewableImagePath('assets/favicon.ico')).toBe(true);
		expect(isPreviewableImagePath('docs/diagram.svg')).toBe(false);
		expect(isPreviewableImagePath('package.json')).toBe(false);
	});

	test('stays image-only, so a PDF does not reach the image surfaces', () => {
		expect(isPreviewableImagePath('docs/spec.pdf')).toBe(false);
		expect(previewImageMimeTypeForPath('docs/spec.pdf')).toBeNull();
	});
});

describe('previewEmbedMimeTypeForPath', () => {
	test('adds PDF to the images the preview receives as raw bytes', () => {
		expect(previewEmbedMimeTypeForPath('docs/spec.pdf')).toBe(
			'application/pdf',
		);
		expect(previewEmbedMimeTypeForPath('docs/SPEC.PDF')).toBe(
			'application/pdf',
		);
		expect(previewEmbedMimeTypeForPath('assets/logo.png')).toBe('image/png');
	});

	test('leaves everything else to the source view', () => {
		expect(previewEmbedMimeTypeForPath('src/main/index.ts')).toBeNull();
		expect(previewEmbedMimeTypeForPath('assets/icon.svg')).toBeNull();
		expect(previewEmbedMimeTypeForPath('.pdf')).toBeNull();
	});
});

describe('imageMimeTypeForPath', () => {
	test('names the formats no browser engine decodes', () => {
		expect(imageMimeTypeForPath('scans/page.tiff')).toBe('image/tiff');
		expect(imageMimeTypeForPath('scans/page.tif')).toBe('image/tiff');
		expect(imageMimeTypeForPath('photos/IMG_0001.HEIC')).toBe('image/heic');
		expect(imageMimeTypeForPath('photos/shot.heif')).toBe('image/heif');
		expect(imageMimeTypeForPath('photos/shot.jxl')).toBe('image/jxl');
	});

	test('still names the formats the preview can embed', () => {
		expect(imageMimeTypeForPath('assets/shot.webp')).toBe('image/webp');
		expect(imageMimeTypeForPath('assets/logo.png')).toBe('image/png');
	});

	test('leaves non-images unnamed', () => {
		expect(imageMimeTypeForPath('src/main/index.ts')).toBeNull();
		expect(imageMimeTypeForPath('docs/spec.pdf')).toBeNull();
		expect(imageMimeTypeForPath('assets/icon.svg')).toBeNull();
	});

	test('keeps the unrenderable formats out of the embeddable set', () => {
		expect(previewEmbedMimeTypeForPath('scans/page.tiff')).toBeNull();
		expect(isPreviewableImagePath('photos/IMG_0001.HEIC')).toBe(false);
	});
});

describe('bytesLookLikeText', () => {
	test('reads a NUL-free payload as text', () => {
		expect(bytesLookLikeText(new TextEncoder().encode('hello\nworld'))).toBe(
			true,
		);
	});

	test('reads a NUL byte in the leading sample as binary', () => {
		expect(bytesLookLikeText(new Uint8Array([0x68, 0x00, 0x69]))).toBe(false);
	});

	test('ignores a NUL past the sniffed sample', () => {
		const bytes = new Uint8Array(9000).fill(0x61);
		bytes[8500] = 0;
		expect(bytesLookLikeText(bytes)).toBe(true);
	});

	test('counts an empty file as text', () => {
		expect(bytesLookLikeText(new Uint8Array())).toBe(true);
	});
});

describe('pdfBytesLookValid', () => {
	test('accepts a payload that opens with the PDF signature', () => {
		expect(pdfBytesLookValid(new TextEncoder().encode('%PDF-1.7\n%âãÏÓ'))).toBe(
			true,
		);
	});

	test('refuses a file that only claims to be one', () => {
		expect(pdfBytesLookValid(new TextEncoder().encode('#!/bin/sh\n'))).toBe(
			false,
		);
		expect(pdfBytesLookValid(new Uint8Array([0x25, 0x50]))).toBe(false);
		expect(pdfBytesLookValid(new Uint8Array())).toBe(false);
	});
});
