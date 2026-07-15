import type { DatabaseSync } from 'node:sqlite';
import { deriveWorkspacePrPresentation } from '../../../shared/github-pr-presentation.ts';
import type { GithubPullRequestSnapshotWire } from '../../../shared/ipc/contracts/github';
import type {
	RepositoryWorkspaceNavigationMetadata,
	RepositoryWorkspaceNavigationRepository,
	RepositoryWorkspaceNavigationSnapshot,
	WorkspacePrPresentation,
} from '../../../shared/ipc/contracts/repository-navigation';

/** Internal: shape of a repository row read from SQLite. */
interface RepositoryRow {
	createdAt: string;
	defaultBranch: string | null;
	id: string;
	metadataJson: string;
	name: string;
	path: string;
	slug: string;
	updatedAt: string;
}

/** Internal: shape of a workspace row read from SQLite. */
interface WorkspaceRow {
	archivedAt: string | null;
	baseBranch: string | null;
	branchName: string | null;
	createdAt: string;
	id: string;
	metadataJson: string;
	name: string;
	path: string;
	/** Cached GitHub PR snapshot JSON joined from `integration_metadata`, if any. */
	pullRequestSnapshotJson: string | null;
	repositoryId: string;
	slug: string;
	updatedAt: string;
}

const SELECT_REPOSITORIES = `
SELECT
	id,
	slug,
	name,
	path,
	default_branch AS defaultBranch,
	created_at AS createdAt,
	updated_at AS updatedAt,
	metadata_json AS metadataJson
FROM repositories
WHERE archived_at IS NULL
ORDER BY lower(name), lower(slug), id
`;

const SELECT_WORKSPACES = `
SELECT
	w.id AS id,
	w.repository_id AS repositoryId,
	w.slug AS slug,
	w.name AS name,
	w.path AS path,
	w.branch_name AS branchName,
	w.base_branch AS baseBranch,
	w.created_at AS createdAt,
	w.updated_at AS updatedAt,
	w.archived_at AS archivedAt,
	w.metadata_json AS metadataJson,
	im.metadata_json AS pullRequestSnapshotJson
FROM workspaces w
LEFT JOIN integration_metadata im
	ON im.provider = 'github'
	AND im.resource_type = 'pull-request'
	AND im.resource_id = w.id
	AND im.external_id = ''
WHERE w.archived_at IS NULL
ORDER BY w.created_at DESC, w.id DESC
`;

/**
 * Builds the repository/workspace navigation snapshot consumed by the renderer
 * sidebar, grouping non-archived workspaces under their parent repository.
 * Archived repositories are excluded entirely so they leave the sidebar on
 * archive and stay gone across restarts (the snapshot carries no archived flag
 * for the renderer to filter on, so the cut has to happen here).
 * @param database - Open SQLite connection or `null`.
 * @returns A navigation snapshot, empty when no database is available.
 */
export function getRepositoryWorkspaceNavigationSnapshot({
	database,
}: {
	database: DatabaseSync | null;
}): RepositoryWorkspaceNavigationSnapshot {
	const generatedAt = new Date().toISOString();

	if (!database) {
		return {
			generatedAt,
			repositories: [],
		};
	}

	const repositories = database
		.prepare(SELECT_REPOSITORIES)
		.all() as unknown as RepositoryRow[];
	const workspaces = database
		.prepare(SELECT_WORKSPACES)
		.all() as unknown as WorkspaceRow[];
	const repositoriesById = new Map<
		string,
		RepositoryWorkspaceNavigationRepository
	>();

	for (const row of repositories) {
		repositoriesById.set(row.id, {
			createdAt: row.createdAt,
			defaultBranch: row.defaultBranch,
			id: row.id,
			metadata: parseMetadataJson(row.metadataJson),
			name: row.name,
			path: row.path,
			slug: row.slug,
			updatedAt: row.updatedAt,
			workspaces: [],
		});
	}

	for (const row of workspaces) {
		const repository = repositoriesById.get(row.repositoryId);

		if (!repository) {
			continue;
		}

		repository.workspaces.push({
			archivedAt: row.archivedAt,
			baseBranch: row.baseBranch,
			branchName: row.branchName,
			createdAt: row.createdAt,
			id: row.id,
			metadata: parseMetadataJson(row.metadataJson),
			name: row.name,
			path: row.path,
			pullRequest: parsePullRequestPresentation(row.pullRequestSnapshotJson),
			repositoryId: row.repositoryId,
			slug: row.slug,
			updatedAt: row.updatedAt,
		});
	}

	return {
		generatedAt,
		repositories: Array.from(repositoriesById.values()),
	};
}

/**
 * Parses a joined PR-snapshot JSON column into the compact presentation the
 * sidebar row renders, tolerating a missing join or malformed cache row.
 * @param snapshotJson - Raw `integration_metadata.metadata_json`, or null.
 * @returns The compact PR presentation, or null when absent/unparseable.
 */
function parsePullRequestPresentation(
	snapshotJson: string | null,
): WorkspacePrPresentation | null {
	if (!snapshotJson) {
		return null;
	}
	try {
		const parsed = JSON.parse(snapshotJson) as GithubPullRequestSnapshotWire;
		return deriveWorkspacePrPresentation(parsed);
	} catch {
		return null;
	}
}

/**
 * Parses the `metadata_json` column safely, defaulting to `{}` on any failure.
 * @param metadataJson - Raw column value.
 * @returns The parsed metadata record.
 */
function parseMetadataJson(
	metadataJson: string,
): RepositoryWorkspaceNavigationMetadata {
	try {
		const parsed = JSON.parse(metadataJson);

		return isJsonRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * Type guard for a non-null, non-array object value.
 * @param value - Candidate value.
 * @returns True when the shape matches.
 */
function isJsonRecord(
	value: unknown,
): value is RepositoryWorkspaceNavigationMetadata {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
