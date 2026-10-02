import { i18n } from '@/renderer/lib/i18n';
import type {
	WorkspaceSource,
	WorkspaceSourceAction,
	WorkspaceSourceKind,
	WorkspaceSourceProvider,
} from '@/renderer/types/workbench';
import { formatChord } from '@/shared/keymap';

/** Source kinds in the order they appear in the create-from picker. */
export const WORKSPACE_SOURCE_KINDS: readonly WorkspaceSourceKind[] = [
	'pull-request',
	'branch',
	'issue',
];

/** The create-from row action that cuts a new branch for the workspace. */
function createAction(): WorkspaceSourceAction {
	return {
		id: 'create',
		label: i18n.t('common:actions.create', 'Create'),
		shortcut: '↵',
		variant: 'primary',
	};
}

/** The create-from row action that hands the workspace an existing branch. */
function adoptBranchAction(): WorkspaceSourceAction {
	return {
		id: 'use-branch',
		label: i18n.t(
			'workbench:workspace-source-picker.action.use-branch',
			'Use branch',
		),
		shortcut: '↵',
		variant: 'primary',
	};
}

/** The create-from row actions offered when a workspace already holds the branch. */
function existingWorkspaceActions(): WorkspaceSourceAction[] {
	return [
		{
			id: 'open',
			label: i18n.t('common:actions.open', 'Open'),
			shortcut: formatChord([], 'Enter'),
			variant: 'secondary',
		},
		{
			id: 'duplicate-branch',
			label: i18n.t(
				'workbench:workspace-source-picker.action.duplicate-branch',
				'Duplicate branch',
			),
			shortcut: formatChord(['mod'], 'Enter'),
			variant: 'primary',
		},
	];
}

const providerLabels: Record<WorkspaceSourceProvider, string> = {
	github: 'GitHub',
	linear: 'Linear',
};

/** Tab label for a source kind, e.g. `Pull requests`. */
export function getWorkspaceSourceKindLabel(kind: WorkspaceSourceKind): string {
	switch (kind) {
		case 'branch':
			return i18n.t(
				'workbench:workspace-source-picker.kind.branch',
				'Branches',
			);
		case 'issue':
			return i18n.t('workbench:workspace-source-picker.kind.issue', 'Issues');
		case 'pull-request':
			return i18n.t(
				'workbench:workspace-source-picker.kind.pull-request',
				'Pull requests',
			);
	}
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
			return [createAction()];
		case 'branch':
			if (source.isDefaultBranch) {
				return [createAction()];
			}
			return source.hasWorkspace
				? existingWorkspaceActions()
				: [adoptBranchAction()];
		case 'pull-request':
			return source.hasWorkspace
				? existingWorkspaceActions()
				: [adoptBranchAction()];
	}
}

/** Human label for a source provider, e.g. `GitHub`. */
export function getWorkspaceSourceProviderLabel(
	provider: WorkspaceSourceProvider,
): string {
	return providerLabels[provider];
}
