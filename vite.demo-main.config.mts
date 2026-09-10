import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Builds the demo window's Electron main and preload bundles into `.demo/`.
 *
 * Separate from `vite.main.config.mts` on purpose: demo mode has its own
 * entrypoint so the shipped main process is neither branched nor rebuilt for it.
 * Build each entry separately: Electron's sandboxed preload cannot require a
 * shared output chunk. The launcher selects the preload with `mode: 'preload'`.
 */
export default defineConfig(({ mode }) => {
	const entry: Record<string, string> =
		mode === 'preload'
			? {
					'demo-preload': fileURLToPath(
						new URL('./demo/demo-preload.ts', import.meta.url),
					),
				}
			: {
					'demo-main': fileURLToPath(
						new URL('./demo/demo-main.ts', import.meta.url),
					),
				};

	return {
		build: {
			emptyOutDir: mode !== 'preload',
			lib: { entry, formats: ['cjs'] },
			outDir: '.demo',
			rollupOptions: {
				external: ['electron', /^node:/],
				output: { entryFileNames: '[name].js' },
			},
			target: 'node24',
		},
		resolve: {
			alias: {
				'@': fileURLToPath(new URL('./src', import.meta.url)),
			},
		},
	};
});
