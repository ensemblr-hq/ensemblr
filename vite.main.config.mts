import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		rollupOptions: {
			external: [
				// Native module: cannot be bundled; resolved from node_modules at runtime.
				'node-pty',
				// Ships its own `claude` executable in a per-platform optional package
				// and calls `createRequire(import.meta.url)` at module load. Rollup
				// rewrites `import.meta.url` to `{}.url` for the CJS main bundle, so
				// bundling it throws `ERR_INVALID_ARG_VALUE` before the app starts.
				// Electron 43 runs Node 24, which can `require()` this ESM-only package.
				'@anthropic-ai/claude-agent-sdk',
			],
		},
	},
});
