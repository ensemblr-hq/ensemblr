import { defineConfig } from 'vite';

import { resolveBuildChannel } from './src/shared/build-channel.ts';

export default defineConfig({
	// The channel the app reports itself as, baked in at build time from the same
	// variable and the same helper `forge.config.ts` derives the bundle id and
	// product name from — so the identity in the bundle and the update feed the
	// app resolves can never disagree. Sniffing `app.getName()` instead would
	// misread dev, which `src/main/main.ts` deliberately renames.
	define: {
		__ENSEMBLR_BUILD_CHANNEL__: JSON.stringify(
			resolveBuildChannel(process.env.ENSEMBLR_BUILD_CHANNEL),
		),
	},
	build: {
		rollupOptions: {
			external: [
				// Native module: cannot be bundled; resolved from node_modules at runtime.
				'node-pty',
				// Ships its own `claude` executable in a per-platform optional package
				// and calls `createRequire(import.meta.url)` at module load. Rollup
				// rewrites `import.meta.url` to `{}.url` for the CJS main bundle, so
				// bundling it throws `ERR_INVALID_ARG_VALUE` before the app starts.
				// Electron 44 runs Node 24, which can `require()` this ESM-only package.
				'@anthropic-ai/claude-agent-sdk',
			],
		},
	},
});
