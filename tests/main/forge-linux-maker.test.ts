import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import {
	APP_LINUX_APP_IDS,
	APP_NAMES,
	KNOWN_CHANNELS,
} from '../../src/shared/build-channel.ts';

// Pinned before the config is imported, because it reads both at module scope:
// `ENSEMBLR_BUILD_CHANNEL=canary` in a contributor's `.env` would rename every
// identity asserted below, and `ENSEMBLR_REQUIRE_SIGN=1` makes the config throw
// an Apple-signing error during collection. Assigned rather than deleted —
// `import 'dotenv/config'` fills in absent keys from `.env` but never overrides
// a key that is already set, empty string included.
process.env.ENSEMBLR_BUILD_CHANNEL = 'release';
process.env.ENSEMBLR_REQUIRE_SIGN = '';

const { default: config } = await import('../../forge.config.ts');

// Every size directory the freedesktop `hicolor` theme declares in its
// `index.theme`. GTK and Qt only look inside the sizes the theme lists, so an
// icon installed under any other one — `1024x1024`, the obvious choice for a
// macOS master — is invisible and the launcher draws its generic placeholder.
const HICOLOR_SIZES = [
	'16x16',
	'22x22',
	'24x24',
	'32x32',
	'36x36',
	'48x48',
	'64x64',
	'72x72',
	'96x96',
	'128x128',
	'192x192',
	'256x256',
	'512x512',
];

/**
 * Finds the AppImage maker instance in the Forge config.
 * @returns The maker, or `undefined` when it is not registered.
 */
function appImageMaker() {
	return config.makers?.find(
		(entry) => (entry as { name?: string }).name === 'AppImage',
	);
}

/**
 * Reads the options the maker was constructed with. `MakerBase` keeps them on
 * `configOrConfigFetcher` until Forge calls `prepareConfig`, so `maker.config`
 * is undefined outside a real make run.
 * @returns The maker's options, or `null` when it is not registered.
 */
function appImageOptions(): Record<string, unknown> | null {
	const maker = appImageMaker() as
		| { configOrConfigFetcher?: { options?: Record<string, unknown> } }
		| undefined;
	return maker?.configOrConfigFetcher?.options ?? null;
}

describe('the AppImage maker', () => {
	test('is registered for linux only', () => {
		const maker = appImageMaker();

		expect(maker).toBeDefined();
		expect((maker as { platforms?: string[] }).platforms).toEqual(['linux']);
	});

	// The maker resolves `bin` against the packaged directory and throws when it
	// is absent, so this is the one option that cannot be chosen freely: it has to
	// be the product name, not the lowercase launcher id. `@electron/packager`
	// names the Linux executable `sanitizeAppName(productName)`, and that
	// sanitizer is `filenamify`, which leaves the space in "Ensemblr Canary"
	// alone — so the product name is the executable name verbatim.
	test('names the executable the packager actually produces', () => {
		const options = appImageOptions();

		expect(options?.bin).toBe(APP_NAMES.release);
	});

	test('takes the launcher id from the channel table, not the product name', () => {
		const options = appImageOptions();

		expect(options?.name).toBe(APP_LINUX_APP_IDS.release);
		expect(options?.productName).toBe(APP_NAMES.release);
	});

	test('registers the deep-link scheme so the desktop entry claims it', () => {
		expect(appImageOptions()?.mimeType).toEqual(['x-scheme-handler/ensemblr']);
	});

	// Electron derives the XDG app id and `WM_CLASS` from the desktop entry's
	// basename (`app.setDesktopName`, wired in src/main/app/linux-desktop-identity.ts).
	// If the file the maker writes is named anything else, the desktop cannot pair
	// the running window with its entry and falls back to a generic icon.
	test('names the desktop entry after the launcher id, not the product name', () => {
		expect(appImageOptions()?.desktopName).toBe(APP_LINUX_APP_IDS.release);
	});
});

describe('the Linux icon set', () => {
	/**
	 * Reads the icon set the AppImage maker was configured with.
	 * @returns The icon set keyed by `hicolor` size directory.
	 */
	function iconSet(): Record<string, string> {
		return (appImageOptions()?.icon ?? {}) as Record<string, string>;
	}

	/**
	 * Lists the `<size>x<size>` keys of the icon set, dropping `default`.
	 * @returns Every size directory the maker will install an icon into.
	 */
	function iconSizes(): string[] {
		return Object.keys(iconSet()).filter((key) => key !== 'default');
	}

	test('installs only into sizes the hicolor theme declares', () => {
		const sizes = iconSizes();

		expect(sizes.length).toBeGreaterThan(0);
		for (const size of sizes) {
			expect(HICOLOR_SIZES).toContain(size);
		}
	});

	test('ships every icon the set points at', () => {
		for (const size of iconSizes()) {
			expect(existsSync(iconSet()[size] as string)).toBe(true);
		}
	});

	// The maker symlinks the default as `.DirIcon`, and would pick `scalable`
	// over any raster when one is offered. `assets/icon.svg` clips its artwork
	// with `clipPath`, which Qt's SVG renderer does not implement, so a KDE
	// desktop handed that file draws the icon unclipped or not at all.
	test('defaults to a raster, and offers no scalable icon at all', () => {
		const icons = iconSet();

		expect(icons.scalable).toBeUndefined();
		expect(icons.default).toBeDefined();
		expect(icons[icons.default as string]).toMatch(/\.png$/);
	});

	// The window carries the same PNG as its own icon, which is the only icon an
	// AppImage the user never integrated into a launcher can show at all.
	test('packages the icons as a resource the main process can read', () => {
		expect(config.packagerConfig?.extraResource).toContain('./assets/icons');
	});
});

describe('the Linux launcher ids', () => {
	test('cover every channel with a distinct, desktop-safe id', () => {
		const ids = KNOWN_CHANNELS.map((channel) => APP_LINUX_APP_IDS[channel]);

		expect(ids).toHaveLength(KNOWN_CHANNELS.length);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) {
			expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
		}
	});

	// A canary that shared the release's id would overwrite its launcher entry
	// and its icon — the Linux counterpart of the bundle-id rule in ADR 0032.
	test('never let a dogfood build claim the release id', () => {
		expect(APP_LINUX_APP_IDS.canary).not.toBe(APP_LINUX_APP_IDS.release);
		expect(APP_LINUX_APP_IDS.dev).not.toBe(APP_LINUX_APP_IDS.release);
	});
});
