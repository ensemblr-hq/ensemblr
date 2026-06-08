import type { DatabaseSync } from 'node:sqlite';

import type {
	RepositoryWorkspaceNavigationMetadata,
	RepositoryWorkspaceNavigationRepository,
	RepositoryWorkspaceNavigationSnapshot,
} from '../../../shared/ipc';

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
ORDER BY lower(name), lower(slug), id
`;

const SELECT_WORKSPACES = `
SELECT
	id,
	repository_id AS repositoryId,
	slug,
	name,
	path,
	branch_name AS branchName,
	base_branch AS baseBranch,
	created_at AS createdAt,
	updated_at AS updatedAt,
	archived_at AS archivedAt,
	metadata_json AS metadataJson
FROM workspaces
WHERE archived_at IS NULL
ORDER BY created_at DESC, id DESC
`;

/**
 * Builds the repository/workspace navigation snapshot consumed by the renderer
 * sidebar, grouping non-archived workspaces under their parent repository.
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
