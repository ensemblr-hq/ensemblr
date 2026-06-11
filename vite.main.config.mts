import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		rollupOptions: {
			// Native module: cannot be bundled; resolved from node_modules at runtime.
			external: ['node-pty'],
		},
	},
});
