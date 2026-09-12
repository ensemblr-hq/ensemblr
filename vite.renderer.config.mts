import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { contentSecurityPolicy } from './src/shared/content-security-policy.ts';

/**
 * Stamps the packaged Content-Security-Policy into `index.html` as a
 * `<meta http-equiv>`.
 *
 * The built renderer is loaded over `file:`, which Electron serves from its own
 * protocol handler rather than through Chromium's network stack, so the
 * `onHeadersReceived` policy in `src/main/app/content-security-policy.ts` is not
 * guaranteed to reach it. Build-time only: the dev server keeps the header
 * path, whose policy carries the HMR relaxations this one must never ship.
 * @returns The Vite plugin that performs the injection.
 */
function stampContentSecurityPolicy(): Plugin {
	return {
		name: 'ensemblr-content-security-policy',
		apply: 'build',
		transformIndexHtml: {
			order: 'pre',
			/**
			 * Inserts the meta tag at the top of `<head>`, before any subresource
			 * the document declares.
			 * @param html - The HTML Vite is about to emit
			 * @returns The HTML with the policy meta tag inserted
			 */
			handler(html: string): string {
				const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(null)}" />`;
				return html.replace('<head>', `<head>\n    ${meta}`);
			},
		},
	};
}

const workspacePort = Number.parseInt(process.env.ENSEMBLR_PORT ?? '', 10);
const devServerPort = Number.isFinite(workspacePort)
	? workspacePort
	: undefined;

export default defineConfig({
	plugins: [
		tanstackRouter({
			autoCodeSplitting: true,
			generatedRouteTree: './src/renderer/routing/routeTree.gen.ts',
			routesDirectory: './src/renderer/routing/routes',
			target: 'react',
		}),
		react(),
		tailwindcss(),
		stampContentSecurityPolicy(),
	],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	server:
		devServerPort === undefined
			? undefined
			: {
					port: devServerPort,
					strictPort: true,
				},
});
