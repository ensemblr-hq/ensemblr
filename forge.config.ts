import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { MakerZIP } from '@electron-forge/maker-zip';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
	packagerConfig: {
		asar: true,
		appBundleId: 'com.ensemble.app',
		extraResource: ['docs/product/mvp-sequencing.md'],
		// Packager resolves the platform extension (`icon.icns` on macOS).
		// Regenerate with `bun run icon:generate`.
		icon: './assets/icon',
		name: 'Ensemble',
	},
	rebuildConfig: {},
	makers: [new MakerZIP({}, ['darwin'])],
	plugins: [
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
