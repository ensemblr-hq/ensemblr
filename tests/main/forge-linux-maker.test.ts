import { describe, expect, test } from 'vitest';

import config from '../../forge.config.ts';
import {
	APP_LINUX_APP_IDS,
	APP_NAMES,
	KNOWN_CHANNELS,
} from '../../src/shared/build-channel.ts';

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
