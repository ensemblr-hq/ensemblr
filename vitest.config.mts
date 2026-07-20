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
 * which `fallow audit --coverage` reads directly. Most of `tests/main` runs on
 * `electron --test`; the 12 pure-logic main-process suites that only need the
 * `node` env are wired in explicitly below (not a `tests/main/**` glob, which
 * would drag in the electron-only suites).
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
		include: [
			'tests/renderer/**/*.test.{ts,tsx}',
			'tests/shared/**/*.test.ts',
			'tests/main/branch-name-slug.test.ts',
			'tests/main/sanitize-title.test.ts',
			'tests/main/parse-naming-response.test.ts',
			'tests/main/launch-env.test.ts',
			'tests/main/request-schemas.test.ts',
			'tests/main/external-links-policy.test.ts',
			'tests/main/app-settings-service.test.ts',
			'tests/main/open-in-editor.test.ts',
			'tests/main/workspace-files-watcher.test.ts',
			'tests/main/agent-activity-monitor.test.ts',
			'tests/main/macos-battery.test.ts',
			'tests/main/workspace-commits.test.ts',
			'tests/main/list-workspace-files.test.ts',
			'tests/main/open-target-paths.test.ts',
			'tests/main/workspace-pr-sweeper.test.ts',
		],
		coverage: {
			provider: 'istanbul',
			reporter: ['text', 'json'],
			reportsDirectory: 'coverage',
			include: ['src/**/*.{ts,tsx}'],
		},
	},
});
