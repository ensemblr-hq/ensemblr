import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

import { nativeImage } from 'electron';

import type {
	DetectedTargetsMap,
	IconSource,
} from './detect-installed-targets.ts';

const ICON_OUTPUT_SIZE = 64;
/**
 * Largest SVG icon inlined as a data URL. Theme SVGs run a few kilobytes; the
 * snapshot is cached to disk and sent over IPC on every boot, so an outlier
 * falls back to the named glyph instead of bloating both.
 */
const MAX_SVG_ICON_BYTES = 256 * 1024;
const SVG_DATA_URL_PREFIX = 'data:image/svg+xml;base64,';
const SVG_EXTENSION = '.svg';
const SVG_MARKUP_MARKER = '<svg';

/**
 * Loads the real icon of each installed target as a data URL. Failures fall
 * back silently to the named icon in the renderer.
 * @param detected - The detection pass's per-target results.
 * @returns Map of registry id to icon data URL; undefined where there is none.
 */
export async function loadIconDataUrls(
	detected: DetectedTargetsMap,
): Promise<Readonly<Record<string, string | undefined>>> {
	const entries = await Promise.all(
		Object.entries(detected).map(async ([id, entry]) => {
			const dataUrl =
				entry.installed && entry.iconSource
					? await loadIconDataUrl(entry.iconSource)
					: null;
			return [id, dataUrl ?? undefined] as const;
		}),
	);
	return Object.fromEntries(entries);
}

/**
 * Loads one target's icon from the source detection found for it.
 * @param source - The app bundle or icon file detection found.
 * @returns The icon data URL, or null when the source is unusable.
 */
function loadIconDataUrl(source: IconSource): Promise<string | null> {
	return source.kind === 'app-bundle'
		? loadAppBundleIcon(source.path)
		: loadIconFile(source.path);
}

/**
 * Renders a small thumbnail for an app bundle as a data URL via
 * `createThumbnailFromPath`. On macOS this hooks into QuickLook (not
 * IconServices / NSWorkspace), so it survives the concurrency that crashed
 * `app.getFileIcon`.
 * @param appPath - Absolute path to the `.app` bundle.
 * @returns The icon data URL, or null when it cannot be rendered.
 */
async function loadAppBundleIcon(appPath: string): Promise<string | null> {
	try {
		const image = await nativeImage.createThumbnailFromPath(appPath, {
			height: ICON_OUTPUT_SIZE,
			width: ICON_OUTPUT_SIZE,
		});
		if (image.isEmpty()) {
			return null;
		}
		return image.toDataURL();
	} catch {
		return null;
	}
}

/**
 * Loads a Linux theme icon file as a data URL. A PNG is decoded and scaled down
 * to {@link ICON_OUTPUT_SIZE} — hicolor ships icons up to 1024 px — while an
 * SVG, which `nativeImage` cannot decode, is inlined as-is for `<img>` to draw.
 * @param iconPath - Absolute path to a `.png` or `.svg` icon.
 * @returns The icon data URL, or null when the file cannot be used.
 */
async function loadIconFile(iconPath: string): Promise<string | null> {
	try {
		if (extname(iconPath).toLowerCase() === SVG_EXTENSION) {
			return await loadSvgDataUrl(iconPath);
		}
		const image = nativeImage.createFromPath(iconPath);
		if (image.isEmpty()) {
			return null;
		}
		const fitted =
			image.getSize().width > ICON_OUTPUT_SIZE
				? image.resize({ quality: 'best', width: ICON_OUTPUT_SIZE })
				: image;
		return fitted.toDataURL();
	} catch {
		return null;
	}
}

/**
 * Inlines an SVG icon as a base64 data URL, refusing an oversized file or one
 * that is not SVG markup so the renderer never shows a broken image.
 * @param iconPath - Absolute path to the `.svg` icon.
 * @returns The data URL, or null when the file is unusable.
 */
async function loadSvgDataUrl(iconPath: string): Promise<string | null> {
	if ((await stat(iconPath)).size > MAX_SVG_ICON_BYTES) {
		return null;
	}
	const markup = await readFile(iconPath);
	if (!markup.includes(SVG_MARKUP_MARKER)) {
		return null;
	}
	return `${SVG_DATA_URL_PREFIX}${markup.toString('base64')}`;
}
