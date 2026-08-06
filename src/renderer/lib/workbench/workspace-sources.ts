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

const EXISTING_WORKSPACE_ACTIONS: readonly WorkspaceSourceAction[] = [
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
 * Row actions for a source, primary action first. A branch or pull-request head
 * that an active workspace already holds can be opened or duplicated — git
 * allows a branch in one worktree at a time, so offering to take it over again
 * would only fail on create. The default branch is the same constraint from the
 * other side: the repository folder holds it, so that row only ever creates.
 *
 * A free branch and a free pull-request head share the same primary action:
 * both hand the workspace an existing branch, and labelling one of them
 * "Create" would promise a new branch the workspace does not cut. Issues, which
 * genuinely have no branch yet, are the only rows that create.
 */
export function getWorkspaceSourceActions(
	source: WorkspaceSource,
): WorkspaceSourceAction[] {
	switch (source.kind) {
		case 'issue':
			return [CREATE_ACTION];
		case 'branch':
			if (source.isDefaultBranch) {
				return [CREATE_ACTION];
			}
			return source.hasWorkspace
				? [...EXISTING_WORKSPACE_ACTIONS]
				: [USE_BRANCH_ACTION];
		case 'pull-request':
			return source.hasWorkspace
				? [...EXISTING_WORKSPACE_ACTIONS]
				: [USE_BRANCH_ACTION];
	}
}

/** Human label for a source provider, e.g. `GitHub`. */
export function getWorkspaceSourceProviderLabel(
	provider: WorkspaceSourceProvider,
): string {
	return providerLabels[provider];
}
