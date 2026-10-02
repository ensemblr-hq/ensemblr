import type { GetArchitectureSnapshotResult } from '@/shared/ipc/contracts/architecture';

import { DEMO_CLOCK } from './workspaces.ts';

/** Current organic architecture snapshot for the architecture panel. */
export const DEMO_ARCHITECTURE_SNAPSHOT: GetArchitectureSnapshotResult = {
	current: {
		generatedAt: DEMO_CLOCK,
		ir: {
			boundaries: [
				{
					kind: 'region',
					label: 'Desktop app',
					wraps: ['renderer', 'preload', 'main'],
				},
			],
			components: [
				{
					id: 'renderer',
					label: 'Renderer',
					sources: [{ path: 'src/renderer/main.tsx' }],
					type: 'frontend',
				},
				{
					id: 'preload',
					label: 'Preload bridge',
					sources: [{ path: 'src/preload/bridge/ensemblr-api.ts' }],
					type: 'security',
				},
				{
					id: 'main',
					label: 'Main process',
					sources: [{ path: 'src/main/main.ts' }],
					type: 'backend',
				},
				{
					id: 'sqlite',
					label: 'Workspace store',
					type: 'database',
				},
				{
					id: 'agents',
					label: 'Agent runtimes',
					type: 'external',
				},
			],
			connections: [
				{ from: 'renderer', id: 'renderer-preload', to: 'preload' },
				{ from: 'preload', id: 'preload-main', to: 'main' },
				{ from: 'main', id: 'main-store', to: 'sqlite' },
				{
					from: 'main',
					id: 'main-agents',
					label: 'RPC',
					to: 'agents',
				},
			],
			layout: { mode: 'organic' },
			meta: {
				subtitle: 'Electron runtime boundaries',
				title: 'Ensemblr architecture',
			},
			schemaVersion: 1,
		},
		relativePath: '.ensemblr/architecture.json',
	},
	previous: null,
};
