import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Builds the demo window's Electron main and preload bundles into `.demo/`.
 *
 * Separate from `vite.main.config.mts` on purpose: demo mode has its own
 * entrypoint so the shipped main process is neither branched nor rebuilt for it.
 * The two share only what `demo-main.ts` imports read-only from `src/`.
 */
export default defineConfig({
	build: {
		emptyOutDir: true,
		lib: {
			entry: {
				'demo-main': fileURLToPath(
					new URL('./demo/demo-main.ts', import.meta.url),
				),
				'demo-preload': fileURLToPath(
					new URL('./demo/demo-preload.ts', import.meta.url),
				),
			},
			formats: ['cjs'],
		},
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
});
