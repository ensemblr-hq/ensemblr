import { DEFAULT_TERMINAL_DOCK_TAB_ID } from '@/renderer/lib/workbench/constants';
import { parseGithubRepoFromRemoteUrl } from '@/renderer/lib/workbench/github-compare-url';
import type {
	DockTabModel,
	ProjectShellModel,
	SessionTabModel,
	WorkspaceLandingKind,
	WorkspaceLandingSummary,
	WorkspaceLinkedIssueSummary,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	RepositoryWorkspaceNavigationRepository,
	RepositoryWorkspaceNavigationSnapshot,
	RepositoryWorkspaceNavigationWorkspace,
} from '@/shared/ipc/contracts/repository-navigation';

// --- Public mappers ---------------------------------------------------------

/**
 * Maps a navigation snapshot to renderer project shell models.
 */
export function mapNavigationSnapshotToProjects(
	snapshot?: RepositoryWorkspaceNavigationSnapshot | null,
): ProjectShellModel[] {
	return mapRepositoriesToProjects(snapshot?.repositories);
}

/**
 * Maps repository navigation rows to renderer project shell models.
 */
export function mapRepositoriesToProjects(
	repositories?: RepositoryWorkspaceNavigationRepository[] | null,
): ProjectShellModel[] {
	return (
		repositories?.map((repository) =>
			mapRepositoryNavigationSnapshot(repository),
		) ?? []
	);
}

/**
 * Picks the navigation snapshot to render, preferring fresh query data over a
 * previously-cached snapshot.
 */
export function getRenderableNavigationSnapshot({
	cachedSnapshot,
	querySnapshot,
}: {
	cachedSnapshot?: RepositoryWorkspaceNavigationSnapshot;
	querySnapshot?: RepositoryWorkspaceNavigationSnapshot;
}): RepositoryWorkspaceNavigationSnapshot | null {
	return querySnapshot ?? cachedSnapshot ?? null;
}

/** Builds a placeholder session tab from a workspace shell model. */
export function createPlaceholderSession(
	workspace: WorkspaceShellModel,
): SessionTabModel {
	const id = `${workspace.id}:overview`;
	return {
		chatTabId: id,
		id,
		label: 'Workspace',
		piSessionId: null,
		status: 'idle',
		summary: 'Workspace session placeholder.',
		updatedLabel: 'loaded',
	};
}

// --- Snapshot → project/workspace mapping (private) -------------------------

/** Maps one repository row to a project shell model, with placeholder workspace data. */
function mapRepositoryNavigationSnapshot(
	repository: RepositoryWorkspaceNavigationRepository,
): ProjectShellModel {
	const remoteUrl = getMetadataString(repository.metadata, [
		'remoteUrl',
		'originUrl',
	]);
	const githubOwner = parseGithubOwnerFromRemoteUrl(remoteUrl);
	const ownerName =
		getMetadataString(repository.metadata, ['ownerName', 'owner']) ??
		githubOwner ??
		getParentDirectoryName(repository.path) ??
		repository.slug;
	const explicitAvatarUrl = getMetadataString(repository.metadata, [
		'avatarUrl',
		'ownerAvatarUrl',
		'githubAvatarUrl',
	]);
	const avatarUrl =
		explicitAvatarUrl ??
		(githubOwner ? `https://github.com/${githubOwner}.png?size=80` : null);

	return {
		id: repository.id,
		name: repository.name || repository.slug,
		owner: {
			...(avatarUrl ? { avatarUrl } : {}),
			name: ownerName,
		},
		pathLabel: repository.path,
		workspaces: repository.workspaces.map((workspace) =>
			mapWorkspaceNavigationSnapshot(repository, workspace, remoteUrl),
		),
	};
}

/** Maps one workspace row to a workspace shell model with placeholder details. */
function mapWorkspaceNavigationSnapshot(
	repository: RepositoryWorkspaceNavigationRepository,
	workspace: RepositoryWorkspaceNavigationWorkspace,
	// Resolved once at the repository level and threaded down so the key-priority
	// list lives in a single place.
	remoteUrl: string | null,
): WorkspaceShellModel {
	const branchName =
		workspace.branchName ??
		workspace.baseBranch ??
		repository.defaultBranch ??
		workspace.slug;

	return {
		branchName,
		changeSummary: {
			additions: 0,
			deletions: 0,
			files: 0,
		},
		checks: {
			detail:
				'Live workspace navigation is loaded from SQLite. Checks are not wired yet.',
			label: 'No checks',
			status: 'pending',
		},
		dockTabs: createPlaceholderDockTabs(),
		githubRepo: parseGithubRepoFromRemoteUrl(remoteUrl),
		id: workspace.id,
		landingSummary: createPlaceholderLandingSummary(repository, workspace),
		name: workspace.name || workspace.slug,
		pathLabel: workspace.path,
		projectId: repository.id,
		pullRequest: {
			checks: [],
			comments: [],
			description: [],
			detail: 'Pull request data is not wired for this workspace yet.',
			gitStatus: {
				label: 'No PR open',
				status: 'open',
			},
			label: 'No PR',
			status: 'idle',
			title: '',
			todos: [],
		},
		reviewFiles: [],
		scripts: createPlaceholderScripts(),
		sessions: [createPlaceholderSessionFromSnapshot(workspace)],
		sourceSummary: getWorkspaceSourceSummary(repository, workspace),
		status: 'idle',
		workspaceFiles: [],
	};
}

/** Renders a short summary of the workspace's source branch. */
function getWorkspaceSourceSummary(
	repository: RepositoryWorkspaceNavigationRepository,
	workspace: RepositoryWorkspaceNavigationWorkspace,
): string {
	if (workspace.baseBranch) {
		return `branched from ${workspace.baseBranch}`;
	}

	if (repository.defaultBranch) {
		return `repository default branch ${repository.defaultBranch}`;
	}

	return 'workspace loaded from SQLite';
}

/** Returns the first non-empty trimmed string value found at any candidate key. */
function getMetadataString(
	metadata: Record<string, unknown>,
	keys: string[],
): string | null {
	for (const key of keys) {
		const value = metadata[key];

		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}

	return null;
}

/** Extracts the parent directory name from a posix-style path. */
function getParentDirectoryName(filePath: string): string | null {
	const normalizedPath = filePath.replace(/\/+$/, '');
	const parentDirectory = normalizedPath.split('/').at(-2);

	return parentDirectory || null;
}

/**
 * Extracts the GitHub owner segment from a remote URL, covering HTTPS, SSH, and
 * `git@`-style remotes. Returns `null` when the host is not github.com or the
 * URL cannot be parsed.
 */
function parseGithubOwnerFromRemoteUrl(
	remoteUrl: string | null,
): string | null {
	return parseGithubRepoFromRemoteUrl(remoteUrl)?.owner ?? null;
}

// --- Placeholder builders (private) -----------------------------------------

/** Returns the placeholder dock tabs (setup/run/default terminal). */
function createPlaceholderDockTabs(): DockTabModel[] {
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
			sessionStatus: null,
			status: 'idle',
			terminalId: null,
		},
	];
}

/** Returns placeholder run/setup script blocks marked as missing. */
function createPlaceholderScripts(): WorkspaceShellModel['scripts'] {
	return {
		run: {
			status: 'missing',
		},
		setup: {
			status: 'missing',
		},
	};
}

/** Builds a placeholder session tab from a workspace navigation row. */
function createPlaceholderSessionFromSnapshot(
	workspace: RepositoryWorkspaceNavigationWorkspace,
): SessionTabModel {
	const id = `${workspace.id}:overview`;
	return {
		chatTabId: id,
		id,
		label: 'Workspace',
		piSessionId: null,
		status: 'idle',
		summary:
			'SQLite workspace record loaded. Agent sessions are not wired yet.',
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
function createPlaceholderLandingSummary(
	repository: RepositoryWorkspaceNavigationRepository,
	workspace: RepositoryWorkspaceNavigationWorkspace,
): WorkspaceLandingSummary {
	const baseBranch = workspace.baseBranch ?? repository.defaultBranch ?? null;
	const branchName =
		workspace.branchName ?? workspace.slug ?? workspace.name ?? 'workspace';
	const linkedIssue = readLinkedIssueMetadata(workspace.metadata);
	const kind = linkedIssue
		? 'linked-issue'
		: inferPlaceholderLandingKind({ baseBranch, branchName });
	const branchDetail = baseBranch
		? `Worktree branched from ${baseBranch}.`
		: 'Worktree created from repository default branch.';
	const headline = linkedIssue
		? `Workspace created from ${linkedIssue.reference}`
		: kind === 'cloned-repo'
			? 'Repository cloned'
			: 'New workspace ready';
	const copiedFiles = readFilesToCopyMetadata(workspace.metadata);

	return {
		branchSource: {
			...(baseBranch ? { baseBranch } : {}),
			branchName,
			detail: branchDetail,
		},
		copiedFiles,
		headline,
		kind,
		...(linkedIssue ? { linkedIssue } : {}),
		repositoryName: repository.name || repository.slug,
		setupGuidance: {
			detail:
				'No setup script is configured for this repository. Add one to bootstrap dependencies before the first Pi turn.',
			state: 'missing',
		},
		workspaceName: workspace.name || workspace.slug || branchName,
	};
}

/**
 * Reads files-to-copy stats persisted under `workspace.metadata.filesToCopy`
 * during workspace creation. Returns the `unavailable` shape when the metadata
 * is missing (older workspace rows pre-dating the wiring).
 */
function readFilesToCopyMetadata(
	metadata: RepositoryWorkspaceNavigationWorkspace['metadata'],
): WorkspaceLandingSummary['copiedFiles'] {
	const raw = metadata.filesToCopy;

	if (typeof raw !== 'object' || raw === null) {
		return {
			count: 0,
			detail: 'Copied files will be shown here once workspace setup completes.',
			state: 'unavailable',
		};
	}

	const record = raw as Record<string, unknown>;
	const copiedCount =
		typeof record.copiedCount === 'number' &&
		Number.isFinite(record.copiedCount)
			? record.copiedCount
			: 0;
	const skippedCount =
		typeof record.skippedCount === 'number' &&
		Number.isFinite(record.skippedCount)
			? record.skippedCount
			: 0;
	const state: WorkspaceLandingSummary['copiedFiles']['state'] =
		copiedCount > 0 ? 'copied' : skippedCount > 0 ? 'skipped' : 'unavailable';
	const detail =
		state === 'copied'
			? `Copied ${copiedCount} local-only file${copiedCount === 1 ? '' : 's'} from repository.`
			: state === 'skipped'
				? 'No local-only files were available to copy from the source.'
				: 'Copied files will be shown here once workspace setup completes.';

	return {
		count: copiedCount,
		detail,
		state,
	};
}

/**
 * Reads the linked-issue summary persisted under `workspace.metadata.linkedIssue`
 * for workspaces created from a Linear issue.
 */
function readLinkedIssueMetadata(
	metadata: RepositoryWorkspaceNavigationWorkspace['metadata'],
): WorkspaceLinkedIssueSummary | null {
	const raw = metadata.linkedIssue;

	if (typeof raw !== 'object' || raw === null) {
		return null;
	}

	const record = raw as Record<string, unknown>;
	const provider = record.provider;
	const identifier = record.identifier;
	const title = record.title;

	if (
		(provider !== 'linear' && provider !== 'github') ||
		typeof identifier !== 'string' ||
		typeof title !== 'string'
	) {
		return null;
	}

	return {
		...(typeof record.description === 'string'
			? { description: record.description }
			: {}),
		provider,
		reference: identifier,
		...(typeof record.id === 'string' ? { remoteId: record.id } : {}),
		...(typeof record.teamName === 'string'
			? { subtitle: record.teamName }
			: {}),
		title,
		...(typeof record.url === 'string' ? { url: record.url } : {}),
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
