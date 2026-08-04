import { describe, expect, test } from 'vitest';

import {
	isPreviewableImagePath,
	previewImageMimeTypeForPath,
} from '@/shared/preview-image';

describe('previewImageMimeTypeForPath', () => {
	test('maps every previewable extension to its browser MIME type', () => {
		expect(previewImageMimeTypeForPath('assets/logo.png')).toBe('image/png');
		expect(previewImageMimeTypeForPath('assets/photo.jpg')).toBe('image/jpeg');
		expect(previewImageMimeTypeForPath('assets/photo.jpeg')).toBe('image/jpeg');
		expect(previewImageMimeTypeForPath('assets/loop.gif')).toBe('image/gif');
		expect(previewImageMimeTypeForPath('assets/shot.webp')).toBe('image/webp');
		expect(previewImageMimeTypeForPath('assets/shot.avif')).toBe('image/avif');
		expect(previewImageMimeTypeForPath('assets/old.bmp')).toBe('image/bmp');
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
		expect(isPreviewableImagePath('docs/diagram.svg')).toBe(false);
		expect(isPreviewableImagePath('package.json')).toBe(false);
	});
});
