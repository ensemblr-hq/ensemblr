import type { DatabaseSync } from 'node:sqlite';

import type {
	RepositoryWorkspaceNavigationMetadata,
	RepositoryWorkspaceNavigationRepository,
	RepositoryWorkspaceNavigationSnapshot,
} from '../../shared/ipc';

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

export function getRepositoryWorkspaceNavigationSnapshot(
	database: DatabaseSync | null,
): RepositoryWorkspaceNavigationSnapshot {
	const generatedAt = new Date().toISOString();

	if (!database) {
		return {
			generatedAt,
			repositories: [],
		};
	}

	const repositories = database
		.prepare(`
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
`)
		.all() as unknown as RepositoryRow[];
	const workspaces = database
		.prepare(`
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
ORDER BY lower(name), lower(slug), id
`)
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

function isJsonRecord(
	value: unknown,
): value is RepositoryWorkspaceNavigationMetadata {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
