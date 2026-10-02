import type { RootDirectorySnapshot } from '@/shared/ipc/contracts/root-directory';

/**
 * Absolute root every scenario's workspaces live under. `WORKSPACE_PATHS` in
 * `fixtures/workspaces.ts` writes the same directory home-collapsed, which is
 * how the app itself renders the two: main collapses a path it puts through a
 * setup check and leaves the configured root as the user typed it.
 */
export const DEMO_ROOT_PATH = '/Users/psoldunov/Code';

/**
 * The managed root as Settings → General and the root-directory setup check
 * read it: healthy, resolved from the declarative config, with every managed
 * subdirectory present.
 * @returns The root snapshot the Ensemblr root directory row hydrates from.
 */
export function demoRootDirectory(): RootDirectorySnapshot {
	return {
		archivedContextsPath: `${DEMO_ROOT_PATH}/archived-contexts`,
		conciergePath: `${DEMO_ROOT_PATH}/concierge`,
		createdPaths: [],
		diagnostics: [],
		managedPaths: [
			{ key: 'repos', path: `${DEMO_ROOT_PATH}/repos`, status: 'present' },
			{
				key: 'workspaces',
				path: `${DEMO_ROOT_PATH}/workspaces`,
				status: 'present',
			},
			{
				key: 'archived-contexts',
				path: `${DEMO_ROOT_PATH}/archived-contexts`,
				status: 'present',
			},
			{
				key: 'concierge',
				path: `${DEMO_ROOT_PATH}/concierge`,
				status: 'present',
			},
		],
		path: DEMO_ROOT_PATH,
		repositoriesPath: `${DEMO_ROOT_PATH}/repos`,
		setting: null,
		source: 'config-default',
		status: 'ok',
		workspacesPath: `${DEMO_ROOT_PATH}/workspaces`,
	};
}
