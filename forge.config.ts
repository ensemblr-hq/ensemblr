import 'dotenv/config';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { promisify } from 'node:util';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';
import MakerAppImage from '@reforged/maker-appimage';

import {
	APP_BUNDLE_IDS,
	APP_LINUX_APP_IDS,
	APP_NAMES,
	resolveBuildChannel,
} from './src/shared/build-channel.ts';

// Build channel drives the app's LaunchServices identity (bundle id + product
// name) — see `src/shared/build-channel.ts` for why each channel gets its own,
// and docs/adr/0032. Release is the default so `npm run make`/`package` keep
// producing the store build; dogfood builds opt in via `ENSEMBLR_BUILD_CHANNEL`
// (see the `make:canary` / `make:dev` scripts). `vite.main.config.mts` resolves
// the same variable through the same helper, so the identity forge bakes in and
// the channel the app reports itself as can never disagree.
const buildChannel = resolveBuildChannel(process.env.ENSEMBLR_BUILD_CHANNEL);

// Files kept in the packaged app. The Vite plugin's default `ignore` excludes
// everything outside `/.vite`, which would drop `node-pty` — a native module
// resolved from `node_modules` at runtime (see vite.main.config.mts
// `external`). We keep the Vite output, plus node-pty and its build-time dep
// `node-addon-api` (needed by @electron/rebuild to recompile the native addon
// against Electron's ABI). AutoUnpackNativesPlugin then unpacks the resulting
// `.node` binary from the asar so it can be loaded at runtime.
// The Claude Agent SDK is kept for the same reason: it is external (see
// vite.main.config.mts), so `sdk.mjs` must exist on disk to be required.
//
// Its per-platform `claude-agent-sdk-<platform>` packages are deliberately NOT
// kept — they carry a ~260 MB `claude` binary, and a user has to install and
// authenticate the real `claude` CLI anyway (`claude /login`). First-class
// Claude therefore requires the user's own binary, found on PATH or set as an
// override. The trailing slash keeps the platform siblings out; the matching
// KEEP_EXACT entries below hold the directories the slash prefix would drop.
const PACKAGE_KEEP_EXACT = new Set([
	'/package.json',
	'/node_modules',
	'/node_modules/@anthropic-ai',
	'/node_modules/@anthropic-ai/claude-agent-sdk',
]);
const PACKAGE_KEEP_PREFIXES = [
	'/.vite',
	'/node_modules/node-pty',
	'/node_modules/node-addon-api',
	'/node_modules/@anthropic-ai/claude-agent-sdk/',
];

// Where `npm run icon:generate` writes the Linux icon ladder: one
// `icon-<size>.png` per freedesktop `hicolor` size. The AppImage installs them
// under `usr/share/icons/hicolor/<size>x<size>/apps/`, and the packaged app
// keeps the same directory as a resource so a window can carry its own icon
// (`src/main/app/linux-desktop-identity.ts`) with no launcher integration at all.
const LINUX_ICONS_DIR = './assets/icons';

// The size that becomes the AppImage's `.DirIcon`. It has to be a raster:
// `assets/icon.svg` clips its artwork with `clipPath`, which Qt's SVG renderer
// does not implement, so a KDE desktop handed the scalable icon draws it
// unclipped or drops it for a generic placeholder.
const LINUX_DEFAULT_ICON_SIZE = 512;

const execFileAsync = promisify(execFile);

/**
 * Builds the AppImage maker's icon set from the generated PNG ladder, keyed by
 * the `hicolor` directory each size installs into. Reading the directory rather
 * than repeating the generator's size list keeps the two from drifting, and an
 * incomplete ladder throws — the maker would otherwise produce an AppImage
 * whose icon no desktop can find, which reads as a successful build.
 * @returns The icon set, with the default size marked for `.DirIcon`
 */
function linuxIconSet(): {
	default: `${number}x${number}`;
	[size: `${number}x${number}`]: string;
} {
	const sizes = readdirSync(LINUX_ICONS_DIR)
		.map((file) => /^icon-(\d+)\.png$/.exec(file))
		.filter((match) => match !== null)
		.map((match) => Number(match[1]));

	if (!sizes.includes(LINUX_DEFAULT_ICON_SIZE)) {
		throw new Error(
			`${LINUX_ICONS_DIR} is missing icon-${LINUX_DEFAULT_ICON_SIZE}.png. ` +
				'Run `npm run icon:generate` to write the Linux icon ladder.',
		);
	}

	const icons: {
		default: `${number}x${number}`;
		[size: `${number}x${number}`]: string;
	} = { default: `${LINUX_DEFAULT_ICON_SIZE}x${LINUX_DEFAULT_ICON_SIZE}` };
	for (const size of sizes) {
		icons[`${size}x${size}`] = `${LINUX_ICONS_DIR}/icon-${size}.png`;
	}
	return icons;
}

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

// Opt-in counterpart to ENSEMBLR_SKIP_SIGN, for builds that are only worth
// producing signed: CI, and a local dry run of what CI will do. Without it a
// missing credential yields an unsigned `.app` and exit code 0, so a release
// job discovers the gap by shipping through it.
const requireSigning = ['1', 'true', 'yes'].includes(
	(process.env.ENSEMBLR_REQUIRE_SIGN ?? '').toLowerCase(),
);

/**
 * List every unmet prerequisite behind `notarizationEnabled`, so a build that
 * demanded signing fails naming the credential it lacked rather than the bare
 * fact that the output is unsigned.
 * @returns One human-readable reason per unmet prerequisite, empty when signing is available
 */
function missingSigningPrerequisites(): string[] {
	const reasons: string[] = [];
	if (process.platform !== 'darwin') {
		reasons.push(`platform is ${process.platform}, not darwin`);
	}
	if (skipSigning) reasons.push('ENSEMBLR_SKIP_SIGN is set');
	if (!appleApiKey) reasons.push('APPLE_API_KEY_PATH is unset');
	else if (!existsSync(appleApiKey)) {
		reasons.push(
			`APPLE_API_KEY_PATH points at a missing file (${appleApiKey})`,
		);
	}
	if (!appleApiKeyId) reasons.push('APPLE_API_KEY_ID is unset');
	if (!appleApiIssuer) reasons.push('APPLE_API_ISSUER is unset');
	return reasons;
}

const unmetSigningPrerequisites = requireSigning
	? missingSigningPrerequisites()
	: [];

if (unmetSigningPrerequisites.length > 0) {
	throw new Error(
		[
			'ENSEMBLR_REQUIRE_SIGN is set, but this build would be unsigned:',
			...unmetSigningPrerequisites.map((reason) => `  • ${reason}`),
			'',
			'Unset ENSEMBLR_REQUIRE_SIGN to allow an unsigned build.',
		].join('\n'),
	);
}

// codesign matches an identity by name prefix, so the common name is enough
// while the keychain holds exactly one Developer ID Application certificate —
// which is the case on a dev machine and on the throwaway keychain CI builds.
// Override when a machine holds several and the prefix would be ambiguous.
const signingIdentity =
	process.env.APPLE_SIGNING_IDENTITY ?? 'Developer ID Application';

/**
 * Sign a DMG, notarize it with Apple's notary service, and staple the returned
 * ticket, so Gatekeeper validates the disk image offline on first open. The
 * `.app` inside is already signed and stapled during packaging; the DMG
 * container is a separate artifact Apple never saw, and stapling a ticket to an
 * *unsigned* image leaves `spctl` with nothing to assess — it reports "no usable
 * signature" however many times the image is notarized. Sign first, then submit.
 * @param dmgPath - Absolute path to the .dmg artifact to sign, notarize and staple
 */
async function stapleNotarizedDmg(dmgPath: string): Promise<void> {
	await execFileAsync('codesign', [
		'--sign',
		signingIdentity,
		'--timestamp',
		'--force',
		dmgPath,
	]);
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
		//
		// The Claude Agent SDK needs no equivalent: its per-platform binary is not
		// packaged, and the user's own `claude` runs from outside the app.
		asar: {
			unpack: '**/node_modules/node-pty/build/Release/spawn-helper',
		},
		...macDistributionConfig,
		// Per-channel bundle id so dogfood builds never share the release's
		// LaunchServices registration (the Dock-flash root cause). See ADR 0032.
		appBundleId: APP_BUNDLE_IDS[buildChannel],
		// macOS kills a process that touches the microphone without a usage
		// description rather than prompting, so composer dictation needs this key
		// alongside the `com.apple.security.device.audio-input` entitlement.
		extendInfo: {
			NSMicrophoneUsageDescription:
				'Ensemblr uses the microphone to dictate prompts into the composer. Audio is sent to the transcription provider you configure and is never stored.',
		},
		extraResource: [
			'resources/pi-extensions',
			'resources/agent-skills',
			LINUX_ICONS_DIR,
		],
		// Packager resolves the platform extension (`icon.icns` on macOS).
		// Regenerate with `npm run icon:generate`.
		icon: './assets/icon',
		// Per-channel product name — the Dock, menu bar and Launch Services
		// identity. userData is *not* per-channel despite deriving from this name:
		// src/main/main.ts pins every packaged channel to the release's directory,
		// and therefore to one shared single-instance lock (ADR 0054).
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
			const notarizationTasks: Promise<void>[] = [];
			for (const result of makeResults) {
				for (const artifact of result.artifacts) {
					if (artifact.endsWith('.dmg')) {
						notarizationTasks.push(stapleNotarizedDmg(artifact));
					}
				}
			}
			await Promise.all(notarizationTasks);
			return makeResults;
		},
	},
	makers: [
		new MakerDMG({ format: 'ULFO' }, ['darwin']),
		new MakerZIP({}, ['darwin']),
		new MakerAppImage(
			{
				options: {
					// `bin` names the executable inside the packaged directory, and the
					// maker throws when it is absent. Packager derives that name from
					// `packagerConfig.name`, so it is the product name — not the
					// launcher id — and the two deliberately differ here.
					bin: APP_NAMES[buildChannel],
					categories: ['Development'],
					compressor: 'zstd',
					// The desktop entry's basename is the app's Linux identity: Electron
					// turns it into the XDG application id on Wayland and `WM_CLASS` on
					// X11, which is how a desktop pairs a window with its icon and how a
					// window manager addresses the app in a rule. `src/main/main.ts`
					// declares the same per-channel id through `app.setDesktopName`, and
					// the two have to agree — the maker would otherwise name the file
					// after the product name ("Ensemblr Canary.desktop", space and all).
					desktopName: APP_LINUX_APP_IDS[buildChannel],
					genericName: 'Multi-agent coding workbench',
					icon: linuxIconSet(),
					// Writes `x-scheme-handler/ensemblr` into the generated `.desktop`
					// file, registering the app as the scheme's handler with the
					// desktop environment. `src/shared/deep-link.ts` has no consumer
					// yet; this only prepares the ground.
					mimeType: ['x-scheme-handler/ensemblr'],
					name: APP_LINUX_APP_IDS[buildChannel],
					productName: APP_NAMES[buildChannel],
				},
			},
			['linux'],
		),
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
