import type { ListAllWorkspacesResult } from '@/shared/ipc/contracts/workspace';

import { DEMO_CLOCK, WORKSPACE_PATHS } from './workspaces.ts';

/** Active and archived rows for the global workspace History screen. */
export const DEMO_WORKSPACE_HISTORY: ListAllWorkspacesResult = {
	entries: [
		{
			archivedAt: null,
			baseBranch: 'main',
			branchCleanup: false,
			branchName: 'release-notes-in-updates-panel',
			createdAt: '2026-09-02T09:15:00.000Z',
			id: 'ws-release-notes',
			name: 'Release notes in updates panel',
			path: WORKSPACE_PATHS.releaseNotes,
			repositoryId: 'repo-ensemblr',
			repositoryName: 'ensemblr',
			slug: 'release-notes',
			updatedAt: DEMO_CLOCK,
			worktreePruned: false,
		},
		{
			archivedAt: '2026-09-03T16:40:00.000Z',
			baseBranch: 'main',
			branchCleanup: false,
			branchName: 'terminal-webgl-renderer',
			createdAt: '2026-08-28T08:00:00.000Z',
			id: 'ws-terminal-webgl',
			name: 'WebGL terminal renderer',
			path: WORKSPACE_PATHS.terminalWebgl,
			repositoryId: 'repo-ensemblr',
			repositoryName: 'ensemblr',
			slug: 'terminal-webgl',
			updatedAt: '2026-09-03T16:40:00.000Z',
			worktreePruned: false,
		},
		{
			archivedAt: '2026-09-01T13:25:00.000Z',
			baseBranch: 'main',
			branchCleanup: true,
			branchName: null,
			createdAt: '2026-08-24T14:10:00.000Z',
			id: 'ws-retired-auth',
			name: 'Retired auth prototype',
			path: '~/Code/workspaces/atlas-api/retired-auth',
			repositoryId: 'repo-atlas',
			repositoryName: 'atlas-api',
			slug: 'retired-auth',
			updatedAt: '2026-09-01T13:25:00.000Z',
			worktreePruned: true,
		},
	],
};
