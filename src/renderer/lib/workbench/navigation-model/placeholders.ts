import { DEFAULT_TERMINAL_DOCK_TAB_ID } from '@/renderer/lib/workbench/constants';
import type {
	DockTabModel,
	SessionTabModel,
	WorkspaceLandingKind,
	WorkspaceLandingSummary,
	WorkspaceOpenTarget,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	RepositoryWorkspaceNavigationRepository,
	RepositoryWorkspaceNavigationWorkspace,
} from '@/shared/ipc';

/** Returns placeholder "open in" targets surfaced before integrations are wired. */
export function createPlaceholderOpenTargets(): WorkspaceOpenTarget[] {
	return [
		{
			iconName: 'lucide:folder',
			id: 'finder',
			installed: true,
			kind: 'file-manager',
			label: 'Finder',
			numberShortcutLabel: '1',
		},
		{
			iconName: 'vscode-icons:file-type-vscode',
			id: 'vscode',
			installed: true,
			isPrimary: true,
			kind: 'editor',
			label: 'VS Code',
			numberShortcutLabel: '2',
			shortcutLabel: '⌘O',
		},
		{
			iconName: 'lucide:square-terminal',
			id: 'terminal',
			installed: true,
			kind: 'terminal',
			label: 'Terminal',
			numberShortcutLabel: '3',
		},
		{
			iconName: 'lucide:copy',
			id: 'copy-path',
			installed: true,
			kind: 'utility',
			label: 'Copy path',
			numberShortcutLabel: '4',
			shortcutLabel: '⌘⇧C',
		},
	];
}

/** Returns the placeholder dock tabs (setup/run/default terminal). */
export function createPlaceholderDockTabs(): DockTabModel[] {
	return [
		{
			id: 'setup',
			kind: 'setup-script',
			label: 'Setup',
			status: 'idle',
		},
		{
			id: 'run',
			kind: 'run-script',
			label: 'Run',
			status: 'idle',
		},
		{
			id: DEFAULT_TERMINAL_DOCK_TAB_ID,
			isDefault: true,
			kind: 'terminal',
			label: 'Terminal',
			lines: [
				'$ zsh',
				'Terminal session loading is not wired for this workspace yet.',
			],
			sessionId: 'terminal-default',
			status: 'idle',
		},
	];
}

/** Returns placeholder run/setup script blocks marked as missing. */
export function createPlaceholderScripts(): WorkspaceShellModel['scripts'] {
	return {
		run: {
			lines: [],
			status: 'missing',
		},
		setup: {
			lines: [],
			status: 'missing',
		},
	};
}

/** Builds a placeholder session tab from a workspace navigation row. */
export function createPlaceholderSessionFromSnapshot(
	workspace: RepositoryWorkspaceNavigationWorkspace,
): SessionTabModel {
	return {
		id: `${workspace.id}:overview`,
		label: 'Workspace',
		status: 'idle',
		summary:
			'SQLite workspace record loaded. Agent sessions are not wired yet.',
		updatedLabel: 'loaded',
	};
}

/** Builds a placeholder session tab from a workspace shell model. */
export function createPlaceholderSession(
	workspace: WorkspaceShellModel,
): SessionTabModel {
	return {
		id: `${workspace.id}:overview`,
		label: 'Workspace',
		status: 'idle',
		summary: 'Workspace session placeholder.',
		updatedLabel: 'loaded',
	};
}

/**
 * Builds a landing summary for a SQLite-backed workspace navigation row.
 * Pi runtime + files-to-copy + setup-script data aren't wired into the
 * navigation snapshot yet, so values stay neutral until those integrations
 * land; the card still shows branch source and a copy/setup placeholder so the
 * new-workspace landing surface is never blank.
 */
export function createPlaceholderLandingSummary(
	repository: RepositoryWorkspaceNavigationRepository,
	workspace: RepositoryWorkspaceNavigationWorkspace,
): WorkspaceLandingSummary {
	const baseBranch = workspace.baseBranch ?? repository.defaultBranch ?? null;
	const branchName =
		workspace.branchName ?? workspace.slug ?? workspace.name ?? 'workspace';
	const kind = inferPlaceholderLandingKind({ baseBranch, branchName });
	const branchDetail = baseBranch
		? `Worktree branched from ${baseBranch}.`
		: 'Worktree created from repository default branch.';
	const headline =
		kind === 'cloned-repo' ? 'Repository cloned' : 'New workspace ready';

	return {
		branchSource: {
			...(baseBranch ? { baseBranch } : {}),
			branchName,
			detail: branchDetail,
		},
		copiedFiles: {
			count: 0,
			detail: 'Copied files will be shown here once workspace setup completes.',
			state: 'unavailable',
		},
		headline,
		kind,
		setupGuidance: {
			detail:
				'No setup script is configured for this repository. Add one to bootstrap dependencies before the first Pi turn.',
			state: 'missing',
		},
	};
}

/**
 * Best-effort kind inference until workspace creation provenance is wired
 * through the navigation snapshot. A workspace that has no diverged branch
 * (branch matches the base) reads as a fresh clone; anything else is treated
 * as a new local branch.
 */
function inferPlaceholderLandingKind({
	baseBranch,
	branchName,
}: {
	baseBranch: string | null;
	branchName: string;
}): WorkspaceLandingKind {
	if (baseBranch && branchName === baseBranch) {
		return 'cloned-repo';
	}

	return 'local-branch';
}
