import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type {
	DetectedTargetsMap,
	IconSource,
} from '../../src/main/open-target/detect-installed-targets.ts';

const nativeImageStub = vi.hoisted(() => ({
	createFromPath: vi.fn(),
	createThumbnailFromPath: vi.fn(),
}));

vi.mock('electron', () => ({ nativeImage: nativeImageStub }));

const { loadIconDataUrls } = await import(
	'../../src/main/open-target/open-target-icons.ts'
);

const SVG_MARKUP =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';
const OVERSIZED_SVG_BYTES = 256 * 1024 + 1;

let workDir = '';

/** A stand-in for the parts of Electron's `NativeImage` the loader calls. */
interface FakeImage {
	getSize: () => { height: number; width: number };
	isEmpty: () => boolean;
	resize: ReturnType<typeof vi.fn>;
	toDataURL: () => string;
}

/**
 * Builds a square fake image whose data URL names its width, so a test can
 * tell a resized image from the original.
 * @param width - Pixel width and height; zero makes the image empty.
 * @returns The fake image.
 */
function fakeImage(width: number): FakeImage {
	return {
		getSize: () => ({ height: width, width }),
		isEmpty: () => width === 0,
		resize: vi.fn((options: { width: number }) => fakeImage(options.width)),
		toDataURL: () => `data:image/png;base64,${width}`,
	};
}

/**
 * Writes a file into the test's working directory.
 * @param name - File name.
 * @param contents - File contents.
 * @returns The absolute path written.
 */
async function writeIcon(name: string, contents: string): Promise<string> {
	const filePath = path.join(workDir, name);
	await writeFile(filePath, contents, 'utf8');
	return filePath;
}

/**
 * Loads the icon of a single installed target.
 * @param iconSource - Where detection found the target's icon.
 * @returns The data URL the loader produced, if any.
 */
async function loadOne(iconSource: IconSource): Promise<string | undefined> {
	const detected: DetectedTargetsMap = {
		probe: { iconSource, installed: true },
	};
	return (await loadIconDataUrls(detected)).probe;
}

beforeEach(async () => {
	workDir = await mkdtemp(path.join(tmpdir(), 'ensemblr-open-target-icons-'));
	nativeImageStub.createFromPath.mockReset();
	nativeImageStub.createThumbnailFromPath.mockReset();
});

afterEach(async () => {
	await rm(workDir, { recursive: true });
});

describe('loadIconDataUrls', () => {
	test('inlines an SVG icon file as a base64 data URL', async () => {
		const iconPath = await writeIcon('probe.svg', SVG_MARKUP);

		expect(await loadOne({ kind: 'icon-file', path: iconPath })).toBe(
			`data:image/svg+xml;base64,${Buffer.from(SVG_MARKUP).toString('base64')}`,
		);
	});

	test('refuses an SVG larger than the inline cap', async () => {
		const iconPath = await writeIcon(
			'huge.svg',
			`<svg>${' '.repeat(OVERSIZED_SVG_BYTES)}</svg>`,
		);

		expect(
			await loadOne({ kind: 'icon-file', path: iconPath }),
		).toBeUndefined();
	});

	test('refuses a .svg file that holds no SVG markup', async () => {
		const iconPath = await writeIcon('fake.svg', 'not an image');

		expect(
			await loadOne({ kind: 'icon-file', path: iconPath }),
		).toBeUndefined();
	});

	test('treats a missing icon file as no icon rather than a failed pass', async () => {
		const iconPath = path.join(workDir, 'gone.svg');

		expect(
			await loadOne({ kind: 'icon-file', path: iconPath }),
		).toBeUndefined();
	});

	test('scales a PNG wider than the output size down to it', async () => {
		const image = fakeImage(1024);
		nativeImageStub.createFromPath.mockReturnValue(image);

		expect(await loadOne({ kind: 'icon-file', path: '/icons/big.png' })).toBe(
			'data:image/png;base64,64',
		);
		expect(image.resize).toHaveBeenCalledWith({ quality: 'best', width: 64 });
	});

	test('keeps a PNG that already fits at its own size', async () => {
		const image = fakeImage(48);
		nativeImageStub.createFromPath.mockReturnValue(image);

		expect(await loadOne({ kind: 'icon-file', path: '/icons/small.png' })).toBe(
			'data:image/png;base64,48',
		);
		expect(image.resize).not.toHaveBeenCalled();
	});

	test('drops a PNG that does not decode', async () => {
		nativeImageStub.createFromPath.mockReturnValue(fakeImage(0));

		expect(
			await loadOne({ kind: 'icon-file', path: '/icons/broken.png' }),
		).toBeUndefined();
	});

	test("renders an app bundle's thumbnail at the output size", async () => {
		nativeImageStub.createThumbnailFromPath.mockResolvedValue(fakeImage(64));

		expect(
			await loadOne({ kind: 'app-bundle', path: '/Applications/Probe.app' }),
		).toBe('data:image/png;base64,64');
		expect(nativeImageStub.createThumbnailFromPath).toHaveBeenCalledWith(
			'/Applications/Probe.app',
			{ height: 64, width: 64 },
		);
	});

	test('treats a thumbnail failure as no icon', async () => {
		nativeImageStub.createThumbnailFromPath.mockRejectedValue(
			new Error('QuickLook unavailable'),
		);

		expect(
			await loadOne({ kind: 'app-bundle', path: '/Applications/Probe.app' }),
		).toBeUndefined();
	});

	test('skips targets that are not installed or have no icon source', async () => {
		const iconPath = await writeIcon('probe.svg', SVG_MARKUP);

		const icons = await loadIconDataUrls({
			absent: {
				iconSource: { kind: 'icon-file', path: iconPath },
				installed: false,
			},
			glyphOnly: { iconSource: null, installed: true },
		});

		expect(icons).toEqual({ absent: undefined, glyphOnly: undefined });
	});
});
