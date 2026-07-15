import { parseGithubRepoFromRemoteUrl } from '@/renderer/lib/workbench/github-compare-url';
import { PENDING_WORKSPACE_CREATION_METADATA_KEY } from '@/renderer/lib/workbench/optimistic-workspace';
import type {
	DockTabModel,
	ProjectShellModel,
	PullRequestShellStatus,
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
	WorkspacePrPresentation,
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
	const isPendingCreation =
		workspace.metadata[PENDING_WORKSPACE_CREATION_METADATA_KEY] === true;
	const presentation = workspace.pullRequest ?? null;

	return {
		branchName,
		changeSummary: {
			additions: 0,
			deletions: 0,
			files: 0,
		},
		checks: isPendingCreation
			? {
					detail: 'The workspace is still being created.',
					label: 'Creating',
					status: 'pending',
				}
			: mapPresentationChecks(presentation),
		dockTabs: createPlaceholderDockTabs(),
		githubRepo: parseGithubRepoFromRemoteUrl(remoteUrl),
		id: workspace.id,
		...(isPendingCreation ? { isPendingCreation } : {}),
		landingSummary: createPlaceholderLandingSummary(repository, workspace),
		name: workspace.name || workspace.slug,
		pathLabel: workspace.path,
		projectId: repository.id,
		pullRequest: mapPresentationPullRequest(presentation),
		reviewFiles: [],
		scripts: createPlaceholderScripts(),
		sessions: [createPlaceholderSessionFromSnapshot(workspace)],
		sourceSummary: isPendingCreation
			? 'creating workspace'
			: getWorkspaceSourceSummary(repository, workspace),
		status: isPendingCreation ? 'working' : 'idle',
		workspaceFiles: [],
	};
}

/** Maps a compact PR presentation onto the sidebar row's checks summary. */
function mapPresentationChecks(
	presentation: WorkspacePrPresentation | null,
): WorkspaceShellModel['checks'] {
	switch (presentation?.status) {
		case 'blocked':
			return {
				detail: 'Checks are failing.',
				label: 'Checks failed',
				status: 'blocked',
			};
		case 'checking':
			return {
				detail: 'Checks are running.',
				label: 'Checks running',
				status: 'pending',
			};
		case 'merged':
			return {
				detail: 'Pull request merged.',
				label: 'Merged',
				status: 'ready',
			};
		case 'closed':
			return {
				detail: 'Pull request closed.',
				label: 'Closed',
				status: 'ready',
			};
		default:
			return {
				detail: 'No checks reported.',
				label: 'No checks',
				status: 'ready',
			};
	}
}

/**
 * Maps a compact PR presentation onto the sidebar row's placeholder PR model.
 * Only the fields the sidebar icon reads (number, status, state) are populated;
 * the heavier panel model is still built from the live snapshot elsewhere.
 */
function mapPresentationPullRequest(
	presentation: WorkspacePrPresentation | null,
): WorkspaceShellModel['pullRequest'] {
	const base = {
		checks: [],
		comments: [],
		description: [],
		gitStatus: { label: 'No PR open', status: 'open' as const },
		title: '',
		todos: [],
	};
	if (!presentation) {
		return {
			...base,
			detail: 'No pull request for this branch yet.',
			label: 'No PR',
			status: 'idle',
		};
	}
	const { state, status } = mapPresentationStatus(presentation.status);
	return {
		...base,
		detail: 'Pull request status from the last GitHub sync.',
		label: 'PR',
		number: presentation.number,
		state,
		status,
	};
}

/** Translates a compact presentation status into the shell PR status + state. */
function mapPresentationStatus(status: WorkspacePrPresentation['status']): {
	state: 'closed' | 'merged' | 'open';
	status: PullRequestShellStatus;
} {
	switch (status) {
		case 'merged':
			return { state: 'merged', status: 'idle' };
		case 'closed':
			return { state: 'closed', status: 'idle' };
		case 'blocked':
			return { state: 'open', status: 'blocked' };
		case 'checking':
			return { state: 'open', status: 'checking' };
		case 'ready':
			return { state: 'open', status: 'ready-to-merge' };
		default:
			return { state: 'open', status: 'idle' };
	}
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
	const copiedFiles = readWorkspaceFileCount(workspace.metadata);

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
 * Reads the total workspace file count persisted under
 * `workspace.metadata.workspaceFileCount` during workspace creation. The count
 * is written once at creation and never backfilled, so a missing value yields
 * the `unavailable` shape — older workspace rows pre-dating the wiring, or rows
 * whose count could not be enumerated at creation.
 */
function readWorkspaceFileCount(
	metadata: RepositoryWorkspaceNavigationWorkspace['metadata'],
): WorkspaceLandingSummary['copiedFiles'] {
	const raw = metadata.workspaceFileCount;
	const workspaceFileCount =
		typeof raw === 'number' && Number.isFinite(raw) ? raw : null;

	if (workspaceFileCount === null) {
		return {
			count: 0,
			detail: 'Workspace file count is unavailable.',
			state: 'unavailable',
		};
	}

	return {
		count: workspaceFileCount,
		detail: `Copied ${workspaceFileCount} file${workspaceFileCount === 1 ? '' : 's'} into workspace.`,
		state: 'copied',
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
