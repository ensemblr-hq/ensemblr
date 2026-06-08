import type {
	ProjectShellModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	RepositoryWorkspaceNavigationRepository,
	RepositoryWorkspaceNavigationSnapshot,
	RepositoryWorkspaceNavigationWorkspace,
} from '@/shared/ipc';

import {
	createPlaceholderDockTabs,
	createPlaceholderLandingSummary,
	createPlaceholderOpenTargets,
	createPlaceholderScripts,
	createPlaceholderSessionFromSnapshot,
} from './placeholders';

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
			mapWorkspaceNavigationSnapshot(repository, workspace),
		),
	};
}

/** Maps one workspace row to a workspace shell model with placeholder details. */
function mapWorkspaceNavigationSnapshot(
	repository: RepositoryWorkspaceNavigationRepository,
	workspace: RepositoryWorkspaceNavigationWorkspace,
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
		id: workspace.id,
		landingSummary: createPlaceholderLandingSummary(repository, workspace),
		name: workspace.name || workspace.slug,
		openTargets: createPlaceholderOpenTargets(),
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
	if (!remoteUrl) {
		return null;
	}

	const match = remoteUrl
		.trim()
		.match(/github\.com[/:]([^/:]+)\/[^/]+?(?:\.git)?\/?$/i);

	return match?.[1] ?? null;
}
