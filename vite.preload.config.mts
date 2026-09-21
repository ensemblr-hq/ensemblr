import { defineConfig, type Plugin } from 'vite';

/**
 * Migrates Forge's single-file preload output onto Rolldown's supported option.
 *
 * Forge merges `inlineDynamicImports: true` after loading this file, so a normal
 * config override cannot remove the deprecated key. Vite's config hook receives
 * that merged object and permits mutation when deep merging cannot express the
 * change.
 * @returns A Vite plugin that preserves Forge's single-file preload bundle.
 */
function migrateForgePreloadCodeSplitting(): Plugin {
	return {
		name: 'ensemblr-forge-preload-code-splitting',
		/**
		 * Replaces Forge's deprecated output option after its config merge.
		 * @param config - The merged Vite configuration.
		 */
		config(config) {
			const output = config.build?.rolldownOptions?.output;
			if (
				!output ||
				Array.isArray(output) ||
				output.inlineDynamicImports !== true
			) {
				return;
			}

			delete output.inlineDynamicImports;
			output.codeSplitting = false;
		},
	};
}

export default defineConfig({
	plugins: [migrateForgePreloadCodeSplitting()],
});
