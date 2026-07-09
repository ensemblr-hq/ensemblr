import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';

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

const config: ForgeConfig = {
	packagerConfig: {
		asar: true,
		appBundleId: 'com.ensemble.app',
		extraResource: ['docs/product/mvp-sequencing.md'],
		// Packager resolves the platform extension (`icon.icns` on macOS).
		// Regenerate with `npm run icon:generate`.
		icon: './assets/icon',
		name: 'Ensemble',
		// Keep only the Vite output plus node-pty (see PACKAGE_KEEP_* above);
		// everything else is excluded from the package.
		ignore: (file: string): boolean => {
			if (!file || PACKAGE_KEEP_EXACT.has(file)) return false;
			return !PACKAGE_KEEP_PREFIXES.some((prefix) => file.startsWith(prefix));
		},
	},
	rebuildConfig: {},
	makers: [new MakerZIP({}, ['darwin'])],
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
