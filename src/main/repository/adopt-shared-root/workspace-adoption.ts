import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { AdoptedWorkspaceSnapshot } from '../../../shared/ipc';
import {
	insertWorkspaceRow,
	refreshWorkspaceAdoptionRow,
	selectWorkspaceIdByPath,
	selectWorkspaceMetadataJson,
} from '../../storage/repositories/workspace-repository.ts';
import { DEFAULT_FALLBACK_BRANCH } from '../git-ops.ts';
import type { GitWorktreeMetadata } from '../git-probe.ts';
import { parseMetadata } from '../metadata.ts';
import { ADOPTION_MODE } from './internal.ts';

/** Loads the workspace row matching `workspacePath`, if any. */
export function findWorkspaceByPath(
	database: DatabaseSync,
	workspacePath: string,
): { id: string } | null {
	const id = selectWorkspaceIdByPath({ database, workspacePath });
	return id ? { id } : null;
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
	const metadataJson = selectWorkspaceMetadataJson({ database, id });
	const existing = parseMetadata(metadataJson ?? undefined);
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

	refreshWorkspaceAdoptionRow({
		branchName: probe.headBranch,
		database,
		id,
		metadataJson: JSON.stringify(nextMetadata),
		timestamp,
	});
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

	insertWorkspaceRow({
		baseBranch,
		branchName,
		database,
		id,
		metadataJson: JSON.stringify(metadata),
		name,
		path: candidatePath,
		repositoryId: repository.id,
		slug,
		timestamp,
	});

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
