import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';

// Build channel drives the app's LaunchServices identity (bundle id + product
// name). Every packaged build that shares one bundle id becomes an
// interchangeable registration for that id: when macOS resolves
// `dev.ensemblr.app` — e.g. while a spawned child touches LaunchServices during
// workspace creation — it can relaunch a *different* registered copy, which
// then hits the running instance's single-instance lock and quits, flashing a
// stray Dock tile. Only the shipped release may claim the canonical id; every
// dogfood build gets its own so it can never masquerade as (or collide with)
// another channel. Release is the default so `npm run make`/`package` keep
// producing the store build; dogfood builds opt in via `ENSEMBLR_BUILD_CHANNEL`
// (see the `make:canary` / `make:dev` scripts). See docs/adr/0032.
const KNOWN_CHANNELS = ['release', 'canary', 'dev'] as const;
type BuildChannel = (typeof KNOWN_CHANNELS)[number];
const requestedChannel = (
	process.env.ENSEMBLR_BUILD_CHANNEL ?? 'release'
).toLowerCase();
const buildChannel: BuildChannel = (
	KNOWN_CHANNELS as readonly string[]
).includes(requestedChannel)
	? (requestedChannel as BuildChannel)
	: 'release';

const APP_BUNDLE_IDS: Record<BuildChannel, string> = {
	release: 'dev.ensemblr.app',
	canary: 'dev.ensemblr.app.canary',
	dev: 'dev.ensemblr.app.dev',
};
const APP_NAMES: Record<BuildChannel, string> = {
	release: 'Ensemblr',
	canary: 'Ensemblr Canary',
	dev: 'Ensemblr Dev',
};

// Files kept in the packaged app. The Vite plugin's default `ignore` excludes
// everything outside `/.vite`, which would drop `node-pty` — a native module
// resolved from `node_modules` at runtime (see vite.main.config.mts
// `external`). We keep the Vite output, plus node-pty and its build-time dep
// `node-addon-api` (needed by @electron/rebuild to recompile the native addon
// against Electron's ABI). AutoUnpackNativesPlugin then unpacks the resulting
// `.node` binary from the asar so it can be loaded at runtime.
const PACKAGE_KEEP_EXACT = new Set(['/package.json', '/node_modules']);
const PACKAGE_KEEP_PREFIXES = [
	'/.vite',
	'/node_modules/node-pty',
	'/node_modules/node-addon-api',
];

const execFileAsync = promisify(execFile);

const appleApiKey = process.env.APPLE_API_KEY_PATH;
const appleApiKeyId = process.env.APPLE_API_KEY_ID;
const appleApiIssuer = process.env.APPLE_API_ISSUER;

// Opt-out switch for local test builds: set `ENSEMBLR_SKIP_SIGN=1` to force an
// unsigned, un-notarized package even when Apple credentials are present in the
// environment, so iterating on a build never pays the signing/notarization cost.
const skipSigning = ['1', 'true', 'yes'].includes(
	(process.env.ENSEMBLR_SKIP_SIGN ?? '').toLowerCase(),
);

// True only when every notarization credential is present on macOS and signing
// was not explicitly skipped. Gates both the packager's osxSign/osxNotarize
// block and the postMake DMG stapling so a dev machine without Apple keys (or
// one that opted out via ENSEMBLR_SKIP_SIGN) still packages (unsigned) instead
// of erroring.
const notarizationEnabled = Boolean(
	process.platform === 'darwin' &&
		!skipSigning &&
		appleApiKey &&
		appleApiKeyId &&
		appleApiIssuer,
);

/**
 * Notarize a signed DMG with Apple's notary service and staple the returned
 * ticket, so Gatekeeper validates the disk image offline on first open. The
 * `.app` inside is already stapled by osxNotarize during packaging; the DMG
 * container is a separate artifact Apple never saw, so it needs its own
 * submission before `stapler staple` can find a ticket.
 * @param dmgPath - Absolute path to the .dmg artifact to notarize and staple
 */
async function stapleNotarizedDmg(dmgPath: string): Promise<void> {
	await execFileAsync('xcrun', [
		'notarytool',
		'submit',
		dmgPath,
		'--key',
		appleApiKey as string,
		'--key-id',
		appleApiKeyId as string,
		'--issuer',
		appleApiIssuer as string,
		'--wait',
	]);
	await execFileAsync('xcrun', ['stapler', 'staple', dmgPath]);
}

const macDistributionConfig = notarizationEnabled
	? {
			osxSign: {
				/** Provides hardened-runtime entitlements for each packaged file. */
				optionsForFile: () => ({
					entitlements: 'entitlements.plist',
					hardenedRuntime: true,
				}),
			},
			osxNotarize: {
				appleApiKey: appleApiKey as string,
				appleApiKeyId: appleApiKeyId as string,
				appleApiIssuer: appleApiIssuer as string,
			},
		}
	: {};

const config: ForgeConfig = {
	packagerConfig: {
		// node-pty's native addon execs a sibling `spawn-helper` binary (macOS) via
		// posix_spawn, resolving it under `app.asar.unpacked`. AutoUnpackNativesPlugin
		// only unpacks `*.node`, so without this glob spawn-helper stays trapped in
		// app.asar, the unpacked path points at a missing file, and every terminal
		// spawn dies with "posix_spawnp failed." The plugin merges this `unpack` glob
		// with its own `*.node` pattern (its existingUnpack handling).
		asar: {
			unpack: '**/node_modules/node-pty/build/Release/spawn-helper',
		},
		...macDistributionConfig,
		// Per-channel bundle id so dogfood builds never share the release's
		// LaunchServices registration (the Dock-flash root cause). See ADR 0032.
		appBundleId: APP_BUNDLE_IDS[buildChannel],
		extraResource: ['docs/product/mvp-sequencing.md'],
		// Packager resolves the platform extension (`icon.icns` on macOS).
		// Regenerate with `npm run icon:generate`.
		icon: './assets/icon',
		// Per-channel product name; also isolates userData (and the
		// single-instance lock keyed on it) for non-release channels.
		name: APP_NAMES[buildChannel],
		// Keep only the Vite output plus node-pty (see PACKAGE_KEEP_* above);
		// everything else is excluded from the package.
		ignore: (file: string): boolean => {
			if (!file || PACKAGE_KEEP_EXACT.has(file)) return false;
			return !PACKAGE_KEEP_PREFIXES.some((prefix) => file.startsWith(prefix));
		},
	},
	rebuildConfig: {},
	hooks: {
		/**
		 * Notarize and staple every DMG artifact after `make`, extending the
		 * notarization ticket from the packaged app to the DMG container so the
		 * shipped disk image passes Gatekeeper without a network round-trip. No-op
		 * when notarization credentials are absent (unsigned dev builds).
		 * @param _config - Resolved Forge configuration (unused)
		 * @param makeResults - Artifacts produced by the make step
		 * @returns The unchanged make results for downstream steps
		 */
		postMake: async (_config, makeResults) => {
			if (!notarizationEnabled) return makeResults;
			const dmgArtifacts = makeResults
				.flatMap((result) => result.artifacts)
				.filter((artifact) => artifact.endsWith('.dmg'));
			for (const dmg of dmgArtifacts) {
				await stapleNotarizedDmg(dmg);
			}
			return makeResults;
		},
	},
	makers: [
		new MakerDMG({ format: 'ULFO' }, ['darwin']),
		new MakerZIP({}, ['darwin']),
	],
	plugins: [
		new AutoUnpackNativesPlugin({}),
		new VitePlugin({
			build: [
				{
					entry: 'src/main/main.ts',
					config: 'vite.main.config.mts',
					target: 'main',
				},
				{
					entry: 'src/preload/preload.ts',
					config: 'vite.preload.config.mts',
					target: 'preload',
				},
			],
			renderer: [
				{
					name: 'main_window',
					config: 'vite.renderer.config.mts',
				},
			],
		}),
		new FusesPlugin({
			version: FuseVersion.V1,
			[FuseV1Options.RunAsNode]: false,
			[FuseV1Options.EnableCookieEncryption]: true,
			[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
			[FuseV1Options.EnableNodeCliInspectArguments]: false,
			[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
			[FuseV1Options.OnlyLoadAppFromAsar]: true,
		}),
	],
};

export default config;
