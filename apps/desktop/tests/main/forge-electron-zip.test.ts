import { describe, expect, test, vi } from 'vitest';

/**
 * Imports a fresh copy of the Forge config with `ENSEMBLR_ELECTRON_ZIP_DIR`
 * set as given. The config reads it at module scope, so each case needs its
 * own module instance. The channel and signing keys are pinned for the reason
 * `tests/main/forge-linux-maker.test.ts` gives, and an unset zip directory is
 * assigned the empty string because `import 'dotenv/config'` would fill a
 * deleted key back in from a contributor's `.env`.
 * @param zipDir - The value to give `ENSEMBLR_ELECTRON_ZIP_DIR`
 * @returns The packager configuration that config produces
 */
async function packagerConfigWith(zipDir: string) {
	vi.resetModules();
	process.env.ENSEMBLR_BUILD_CHANNEL = 'release';
	process.env.ENSEMBLR_REQUIRE_SIGN = '';
	process.env.ENSEMBLR_ELECTRON_ZIP_DIR = zipDir;
	const { default: config } = await import('../../forge.config.ts');
	return config.packagerConfig ?? {};
}

describe('the Electron zip directory', () => {
	test('is left to packager when unset, so it downloads the zip itself', async () => {
		const packagerConfig = await packagerConfigWith('');

		expect(packagerConfig.electronZipDir).toBeUndefined();
	});

	test('is handed to packager when a Nix build names one', async () => {
		const packagerConfig = await packagerConfigWith(
			'/nix/store/example-ensemblr-deps/electron',
		);

		expect(packagerConfig.electronZipDir).toBe(
			'/nix/store/example-ensemblr-deps/electron',
		);
	});
});
