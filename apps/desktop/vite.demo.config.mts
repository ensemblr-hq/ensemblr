import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const DEMO_ENTRY = '/demo/';
const DEFAULT_PORT = 5299;

const configuredPort = Number.parseInt(
	process.env.ENSEMBLR_DEMO_PORT ?? '',
	10,
);

/**
 * Sends bare `/` requests to the demo entry so the dev server never serves the
 * Electron `index.html`, which boots the shipped renderer against a preload
 * bridge the demo window deliberately does not install.
 */
function redirectRootToDemo(): Plugin {
	return {
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				if (request.url === '/' || request.url === '/index.html') {
					response.writeHead(302, { Location: DEMO_ENTRY });
					response.end();
					return;
				}
				next();
			});
		},
		name: 'ensemblr-demo-root-redirect',
	};
}

export default defineConfig({
	plugins: [react(), tailwindcss(), redirectRootToDemo()],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	server: {
		port: Number.isFinite(configuredPort) ? configuredPort : DEFAULT_PORT,
		strictPort: false,
	},
});
