import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const PLAYGROUND_ENTRY = '/playground/';
const DEFAULT_PORT = 5199;

const configuredPort = Number.parseInt(
	process.env.ENSEMBLR_PLAYGROUND_PORT ?? '',
	10,
);

/**
 * Sends bare `/` requests to the playground entry so the dev server never
 * serves the Electron `index.html`, which boots the router and preload bridge.
 */
function redirectRootToPlayground(): Plugin {
	return {
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				if (request.url === '/' || request.url === '/index.html') {
					response.writeHead(302, { Location: PLAYGROUND_ENTRY });
					response.end();
					return;
				}
				next();
			});
		},
		name: 'ensemblr-playground-root-redirect',
	};
}

export default defineConfig({
	plugins: [react(), tailwindcss(), redirectRootToPlayground()],
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
