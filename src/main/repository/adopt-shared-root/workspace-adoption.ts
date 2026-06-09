import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { AdoptedWorkspaceSnapshot } from '../../../shared/ipc';
import { DEFAULT_FALLBACK_BRANCH } from '../git-ops.ts';
import type { GitWorktreeMetadata } from '../git-probe.ts';
import { parseMetadata } from '../metadata.ts';
import { ADOPTION_MODE } from './internal.ts';

/** Loads the workspace row matching `workspacePath`, if any. */
export function findWorkspaceByPath(
	database: DatabaseSync,
	workspacePath: string,
): { id: string } | null {
	const row = database
		.prepare('SELECT id FROM workspaces WHERE path = ?')
		.get(workspacePath);

	if (
		typeof row !== 'object' ||
		row === null ||
		typeof (row as Record<string, unknown>).id !== 'string'
	) {
		return null;
	}
	return row as { id: string };
}

/**
 * Refreshes an existing workspace row to reflect the current branch and head
 * observed on disk, updating adoption tracking fields without overwriting any
 * other metadata.
 */
export function refreshWorkspaceRow({
	database,
	id,
	probe,
	timestamp,
}: {
	database: DatabaseSync;
	id: string;
	probe: GitWorktreeMetadata;
	timestamp: string;
}): void {
	const row = database
		.prepare(
			'SELECT metadata_json AS metadataJson FROM workspaces WHERE id = ?',
		)
		.get(id) as { metadataJson: string } | undefined;
	const existing = parseMetadata(row?.metadataJson);
	const adoption =
		typeof existing.adoption === 'object' && existing.adoption !== null
			? (existing.adoption as Record<string, unknown>)
			: {};
	const nextMetadata = {
		...existing,
		adoption: {
			...adoption,
			lastSeenAt: timestamp,
		},
	};

	database
		.prepare(
			`UPDATE workspaces
				SET updated_at = ?,
					branch_name = COALESCE(?, branch_name),
					metadata_json = ?
				WHERE id = ?`,
		)
		.run(timestamp, probe.headBranch, JSON.stringify(nextMetadata), id);
}

/**
 * Inserts a new workspace row for a discovered git worktree, recording the
 * adoption metadata used by the UI to badge the workspace.
 */
export function adoptWorkspaceRow({
	candidatePath,
	database,
	probe,
	repository,
	slug,
	timestamp,
}: {
	candidatePath: string;
	database: DatabaseSync;
	probe: GitWorktreeMetadata;
	repository: { defaultBranch: string | null; id: string; slug: string };
	slug: string;
	timestamp: string;
}): AdoptedWorkspaceSnapshot {
	const id = `workspace-${randomUUID()}`;
	const name = slug;
	const branchName = probe.headBranch;
	const baseBranch =
		repository.defaultBranch ?? probe.defaultBranch ?? DEFAULT_FALLBACK_BRANCH;
	const metadata: Record<string, unknown> = {
		adoption: {
			adoptedAt: timestamp,
			lastSeenAt: timestamp,
			origin: 'shared-root',
		},
		adoptionMode: ADOPTION_MODE,
	};

	database
		.prepare(
			`INSERT INTO workspaces (
				id,
				repository_id,
				slug,
				name,
				path,
				branch_name,
				base_branch,
				created_at,
				updated_at,
				metadata_json
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			repository.id,
			slug,
			name,
			candidatePath,
			branchName,
			baseBranch,
			timestamp,
			timestamp,
			JSON.stringify(metadata),
		);

	return {
		adoptedAt: timestamp,
		archivedAt: null,
		baseBranch,
		branchName,
		createdAt: timestamp,
		id,
		metadata,
		name,
		path: candidatePath,
		repositoryId: repository.id,
		slug,
		updatedAt: timestamp,
	};
}
