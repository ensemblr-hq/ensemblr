import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const conductorPort = Number.parseInt(process.env.CONDUCTOR_PORT ?? '', 10);
const devServerPort = Number.isFinite(conductorPort)
	? conductorPort
	: undefined;

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server:
		devServerPort === undefined
			? undefined
			: {
					port: devServerPort,
					strictPort: true,
				},
});
