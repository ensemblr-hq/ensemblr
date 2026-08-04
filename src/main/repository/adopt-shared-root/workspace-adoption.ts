import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { SharedRootAdoptionDiagnostic } from '../../../shared/ipc/contracts/shared-root-adoption';
import type { AdoptedWorkspaceSnapshot } from '../../../shared/ipc/contracts/workspace';
import {
	insertWorkspaceRow,
	refreshWorkspaceAdoptionRow,
	selectWorkspaceIdByPath,
	selectWorkspaceMetadataJson,
} from '../../storage/repositories/workspace-repository.ts';
import { DEFAULT_FALLBACK_BRANCH } from '../git-ops.ts';
import type { GitWorktreeMetadata, GitWorktreeProbeFn } from '../git-probe.ts';
import { trackBranchCollision } from './branch-collisions.ts';
import {
	ADOPTION_MODE,
	patchAdoptionMetadata,
	type RepositoryAdoptionInfo,
} from './internal.ts';
import { findRepositoryBySlug } from './repository-adoption.ts';

/**
 * What one pass over the shared root's workspaces produced: newly adopted rows,
 * refreshed row ids, every path the scan visited, and the branch collisions it
 * observed per repository.
 */
export interface WorkspaceReconciliation {
	adopted: AdoptedWorkspaceSnapshot[];
	collisionsByRepo: Map<string, Map<string, string[]>>;
	refreshedIds: string[];
	scannedPaths: Set<string>;
}

/**
 * Probe every worktree under the shared root's workspaces directory and
 * reconcile SQLite with what is on disk, adopting new worktrees and refreshing
 * known ones. Workspace folders whose repository slug resolves to nothing are
 * reported as orphaned rather than adopted.
 * @param childrenByRepository - Workspace directory names, keyed by repository slug
 * @param database - Open database handle
 * @param diagnostics - Collector the adoption snapshot reports through
 * @param repositoriesBySlug - Repositories the repository pass already resolved
 * @param repositorySlugs - Repository slugs found directly under the workspaces root
 * @param timestamp - Scan timestamp stamped onto adopted and refreshed rows
 * @param workspacesPath - Absolute path of the workspaces root
 * @param worktreeProbe - Probe that inspects a candidate directory as a git worktree
 * @returns The reconciliation outcome for the workspaces layer
 */
export async function reconcileWorkspaces({
	childrenByRepository,
	database,
	diagnostics,
	repositoriesBySlug,
	repositorySlugs,
	timestamp,
	workspacesPath,
	worktreeProbe,
}: {
	childrenByRepository: ReadonlyMap<string, readonly string[]>;
	database: DatabaseSync;
	diagnostics: SharedRootAdoptionDiagnostic[];
	repositoriesBySlug: ReadonlyMap<string, RepositoryAdoptionInfo>;
	repositorySlugs: readonly string[];
	timestamp: string;
	workspacesPath: string;
	worktreeProbe: GitWorktreeProbeFn;
}): Promise<WorkspaceReconciliation> {
	const outcome: WorkspaceReconciliation = {
		adopted: [],
		collisionsByRepo: new Map(),
		refreshedIds: [],
		scannedPaths: new Set(),
	};

	for (const repoSlug of repositorySlugs) {
		const repoWorkspacesPath = path.join(workspacesPath, repoSlug);
		const repoInfo =
			repositoriesBySlug.get(repoSlug) ??
			findRepositoryBySlug(database, repoSlug);

		if (!repoInfo) {
			diagnostics.push({
				code: 'workspace-orphaned',
				message: `Workspaces exist for unknown repository slug "${repoSlug}".`,
				path: repoWorkspacesPath,
				severity: 'warning',
			});
			continue;
		}

		// Probes stay per-repository so a slug that resolves to nothing costs no
		// filesystem work at all.
		// oxlint-disable-next-line react-doctor/async-await-in-loop
		const probes = await Promise.all(
			(childrenByRepository.get(repoSlug) ?? []).map(async (workspaceSlug) => {
				const candidatePath = path.join(repoWorkspacesPath, workspaceSlug);
				return {
					candidatePath,
					probe: await worktreeProbe(candidatePath),
					workspaceSlug,
				};
			}),
		);

		for (const { candidatePath, probe, workspaceSlug } of probes) {
			outcome.scannedPaths.add(candidatePath);
			reconcileOneWorkspace({
				candidatePath,
				database,
				diagnostics,
				outcome,
				probe,
				repoInfo,
				timestamp,
				workspaceSlug,
			});
		}
	}

	return outcome;
}

/**
 * Reconcile one probed worktree into SQLite, folding its branch into the
 * collision index either way.
 * @param candidatePath - Absolute path of the probed directory
 * @param database - Open database handle
 * @param diagnostics - Collector the adoption snapshot reports through
 * @param outcome - Accumulator for the workspaces layer
 * @param probe - Worktree probe result for the candidate
 * @param repoInfo - The repository the workspace slug hangs off
 * @param timestamp - Scan timestamp stamped onto the row
 * @param workspaceSlug - Directory name the workspace is adopted under
 */
function reconcileOneWorkspace({
	candidatePath,
	database,
	diagnostics,
	outcome,
	probe,
	repoInfo,
	timestamp,
	workspaceSlug,
}: {
	candidatePath: string;
	database: DatabaseSync;
	diagnostics: SharedRootAdoptionDiagnostic[];
	outcome: WorkspaceReconciliation;
	probe: GitWorktreeMetadata;
	repoInfo: RepositoryAdoptionInfo;
	timestamp: string;
	workspaceSlug: string;
}): void {
	if (!probe.isWorktree || probe.topLevel !== candidatePath) {
		diagnostics.push({
			code: 'invalid-worktree',
			message: probe.error ?? 'The directory is not a git worktree.',
			path: candidatePath,
			severity: 'warning',
		});
		return;
	}

	if (
		probe.mainRepositoryPath &&
		path.resolve(probe.mainRepositoryPath) !== path.resolve(repoInfo.path)
	) {
		diagnostics.push({
			code: 'worktree-repository-mismatch',
			message:
				'The worktree main repository does not match the parent repo slug.',
			path: candidatePath,
			severity: 'warning',
		});
	}

	const existing = findWorkspaceByPath(database, candidatePath);
	let workspaceId: string;
	if (existing) {
		refreshWorkspaceRow({ database, id: existing.id, probe, timestamp });
		outcome.refreshedIds.push(existing.id);
		workspaceId = existing.id;
	} else {
		const adopted = adoptWorkspaceRow({
			candidatePath,
			database,
			probe,
			repository: repoInfo,
			slug: workspaceSlug,
			timestamp,
		});
		outcome.adopted.push(adopted);
		workspaceId = adopted.id;
	}

	trackBranchCollision({
		branch: probe.headBranch,
		collisionsByRepo: outcome.collisionsByRepo,
		id: workspaceId,
		repositoryId: repoInfo.id,
	});
}

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
	const nextMetadata = patchAdoptionMetadata({
		metadataJson: selectWorkspaceMetadataJson({ database, id }) ?? undefined,
		patch: { lastSeenAt: timestamp },
	});

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
