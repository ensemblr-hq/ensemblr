import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the renderer and shared test suites.
 *
 * The default environment is `node` so platform-sensitive pure-logic tests
 * (keymap, etc.) keep the real `navigator`/`process`. DOM component tests opt
 * into happy-dom per file with a `// @vitest-environment happy-dom` docblock.
 * Coverage uses the Istanbul provider and emits `coverage/coverage-final.json`,
 * which `fallow audit --coverage` reads directly. `tests/main` is intentionally
 * excluded — those tests run on `electron --test`.
 */
export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	test: {
		globals: true,
		environment: 'node',
		setupFiles: ['./tests/renderer/support/vitest.setup.ts'],
		include: ['tests/renderer/**/*.test.{ts,tsx}', 'tests/shared/**/*.test.ts'],
		coverage: {
			provider: 'istanbul',
			reporter: ['text', 'json'],
			reportsDirectory: 'coverage',
			include: ['src/**/*.{ts,tsx}'],
		},
	},
});
