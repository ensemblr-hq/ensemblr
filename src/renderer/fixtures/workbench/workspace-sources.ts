import type { WorkspaceSource } from '@/renderer/types/workbench';

/**
 * Seed sources for the create-workspace-from picker. Fixture-backed until the
 * GitHub (`gh`) and Linear services land; no live data is fetched here.
 */
export const defaultWorkspaceSources: WorkspaceSource[] = [
	{
		id: 'pr-30',
		kind: 'pull-request',
		provider: 'github',
		reference: '#30',
		subtitle: 'philipp/the-117-ens-017-project-add-menu',
		title: 'THE-117 Project add menu and recents',
	},
	{
		id: 'pr-28',
		kind: 'pull-request',
		provider: 'github',
		reference: '#28',
		subtitle: 'philipp/the-120-ens-020-sidebar-navigation',
		title: 'THE-120 Add repository workspace navigation',
	},
	{
		id: 'pr-27',
		kind: 'pull-request',
		provider: 'github',
		reference: '#27',
		subtitle: 'psoldunov/main-window-restore',
		title: 'Persist main window state',
	},
	{
		hasWorkspace: true,
		id: 'branch-add-menu',
		kind: 'branch',
		provider: 'local-git',
		title: 'philipp/the-117-ens-017-project-add-menu-and-recents',
	},
	{
		id: 'branch-master',
		kind: 'branch',
		provider: 'local-git',
		title: 'master',
	},
	{
		hasWorkspace: true,
		id: 'branch-next-linear',
		kind: 'branch',
		provider: 'local-git',
		title: 'psoldunov/next-linear-ticket',
	},
	{
		id: 'branch-routes',
		kind: 'branch',
		provider: 'github',
		subtitle: 'origin',
		title: 'psoldunov/routes-under-renderer',
	},
	{
		id: 'branch-sidebar-nav',
		kind: 'branch',
		provider: 'github',
		subtitle: 'origin',
		title: 'philipp/the-120-ens-020-sidebar-repository-workspace-navigation',
	},
	{
		id: 'branch-config-parser',
		kind: 'branch',
		provider: 'github',
		subtitle: 'origin',
		title: 'philipp/the-116-ens-015-repository-config-parser-for-ensemble',
	},
	{
		id: 'issue-the-118',
		kind: 'issue',
		provider: 'linear',
		reference: 'THE-118',
		subtitle: 'Ensemble · Todo',
		title: 'Workspace creation from source picker',
	},
	{
		id: 'issue-the-121',
		kind: 'issue',
		provider: 'linear',
		reference: 'THE-121',
		subtitle: 'Ensemble · Backlog',
		title: 'Persist sidebar reorder and pin state',
	},
	{
		id: 'issue-gh-44',
		kind: 'issue',
		provider: 'github',
		reference: '#44',
		subtitle: 'bug',
		title: 'Recents list should de-duplicate by resolved path',
	},
	{
		id: 'issue-gh-41',
		kind: 'issue',
		provider: 'github',
		reference: '#41',
		subtitle: 'enhancement',
		title: 'Add keyboard shortcut for the create-from picker',
	},
];
