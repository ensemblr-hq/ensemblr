import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		rollupOptions: {
			// `@electron-forge/plugin-vite@7.11.2` (currently the latest) forces
			// `output.inlineDynamicImports: true` for the single-file preload bundle,
			// which Vite 8 / Rollup 4 deprecated in favor of `codeSplitting: false`.
			// The plugin merges our config last, but `mergeConfig` can only override
			// keys — never delete the one it set — so we cannot swap the option here.
			// Suppress only that one deprecation and forward every other warning.
			// Remove once the plugin migrates off `inlineDynamicImports`.
			onwarn(warning, defaultHandler) {
				if (warning.message.includes('inlineDynamicImports')) {
					return;
				}
				defaultHandler(warning);
			},
		},
	},
});
