import type {
	WorkspaceSource,
	WorkspaceSourceAction,
	WorkspaceSourceKind,
	WorkspaceSourceProvider,
} from '@/renderer/types/workbench';

/** Source kinds in the order they appear in the create-from picker. */
export const WORKSPACE_SOURCE_KINDS: readonly WorkspaceSourceKind[] = [
	'pull-request',
	'branch',
	'issue',
];

const kindLabels: Record<WorkspaceSourceKind, string> = {
	branch: 'Branches',
	issue: 'Issues',
	'pull-request': 'Pull requests',
};

const CREATE_ACTION: WorkspaceSourceAction = {
	id: 'create',
	label: 'Create',
	shortcut: '↵',
	variant: 'primary',
};

const USE_BRANCH_ACTION: WorkspaceSourceAction = {
	id: 'use-branch',
	label: 'Use branch',
	shortcut: '↵',
	variant: 'primary',
};

const BRANCH_WORKSPACE_ACTIONS: readonly WorkspaceSourceAction[] = [
	{ id: 'open', label: 'Open', shortcut: '↵', variant: 'secondary' },
	{
		id: 'duplicate-branch',
		label: 'Duplicate branch',
		shortcut: '⌘↵',
		variant: 'primary',
	},
];

const providerLabels: Record<WorkspaceSourceProvider, string> = {
	github: 'GitHub',
	linear: 'Linear',
};

/** Tab label for a source kind, e.g. `Pull requests`. */
export function getWorkspaceSourceKindLabel(kind: WorkspaceSourceKind): string {
	return kindLabels[kind];
}

/**
 * Row actions for a source, primary action first. A branch that already has a
 * workspace in the project can be opened or duplicated; every other source
 * creates a new workspace.
 */
export function getWorkspaceSourceActions(
	source: WorkspaceSource,
): WorkspaceSourceAction[] {
	switch (source.kind) {
		case 'issue':
			return [CREATE_ACTION];
		case 'branch':
			// A branch backing an active workspace offers Open + Duplicate;
			// otherwise it forks a fresh workspace.
			return source.hasWorkspace
				? [...BRANCH_WORKSPACE_ACTIONS]
				: [USE_BRANCH_ACTION];
		case 'pull-request':
			return [CREATE_ACTION];
	}
}

/** Human label for a source provider, e.g. `GitHub`. */
export function getWorkspaceSourceProviderLabel(
	provider: WorkspaceSourceProvider,
): string {
	return providerLabels[provider];
}
