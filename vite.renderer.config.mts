import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const conductorPort = Number.parseInt(process.env.CONDUCTOR_PORT ?? '', 10);
const devServerPort = Number.isFinite(conductorPort)
	? conductorPort
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
