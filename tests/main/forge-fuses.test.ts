import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { describe, expect, test } from 'vitest';

// Pinned before the config is imported, for the same reason
// `tests/main/forge-linux-maker.test.ts` pins them: the config reads both at
// module scope, and `ENSEMBLR_REQUIRE_SIGN=1` makes it throw during collection.
process.env.ENSEMBLR_BUILD_CHANNEL = 'release';
process.env.ENSEMBLR_REQUIRE_SIGN = '';

const { default: config } = await import('../../forge.config.ts');

/**
 * Reads the fuse configuration the Fuses plugin was constructed with. The
 * plugin keeps it on `fusesConfig` and exposes no accessor, so this reaches for
 * the field the way the maker tests reach for `configOrConfigFetcher`.
 * @returns The fuse map, keyed by `FuseV1Options`.
 */
function fuses(): Record<string, unknown> {
	const plugin = config.plugins?.find(
		(entry) => (entry as { name?: string }).name === 'fuses',
	) as { fusesConfig?: Record<string, unknown> } | undefined;
	return plugin?.fusesConfig ?? {};
}

// Each of these is a security property the shipped binary either has or does
// not, decided at package time and invisible afterwards. Asserting the set the
// way `tests/main/database.test.ts` asserts migration ids means dropping one is
// a red test rather than a silent regression.
describe('the packaged binary fuses', () => {
	test('are configured at all, in the V1 format', () => {
		expect(fuses().version).toBe(FuseVersion.V1);
	});

	test('refuse to run the binary as a plain Node process', () => {
		expect(fuses()[FuseV1Options.RunAsNode]).toBe(false);
	});

	test('refuse NODE_OPTIONS and the Node CLI inspect flags', () => {
		expect(fuses()[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(
			false,
		);
		expect(fuses()[FuseV1Options.EnableNodeCliInspectArguments]).toBe(false);
	});

	test('encrypt cookies and pin the app to a validated asar', () => {
		expect(fuses()[FuseV1Options.EnableCookieEncryption]).toBe(true);
		expect(fuses()[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(
			true,
		);
		expect(fuses()[FuseV1Options.OnlyLoadAppFromAsar]).toBe(true);
	});

	// Closed, which the renderer only survives because it is no longer a `file:`
	// document — `src/main/app/app-protocol.ts` serves it from `app://bundle`
	// (ADR 0072). Pinned at `false` because the pair is one change: a build that
	// loaded `file:` with this off would refuse every module script in the
	// bundle and come up blank.
	test('refuse the extra file: protocol privileges', () => {
		expect(fuses()[FuseV1Options.GrantFileProtocolExtraPrivileges]).toBe(false);
	});
});
