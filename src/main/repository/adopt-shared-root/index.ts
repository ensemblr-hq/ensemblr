import path from 'node:path';

import type { AdoptedRepositorySnapshot } from '../../../shared/ipc/contracts/repository';
import type { AdoptedWorkspaceSnapshot } from '../../../shared/ipc/contracts/workspace';
import type { SharedRootAdoptionDiagnostic, SharedRootAdoptionSnapshot, SharedRootAdoptionStatus } from '../../../shared/ipc/contracts/shared-root-adoption';
import {
	type LoadedRepositoryConfig,
	type LoadRepositoryConfigOptions,
	loadRepositoryConfig,
} from '../../config/repository-config.ts';
import type { EnsembleRootDirectoryService } from '../../root';
import type { EnsembleDatabaseService } from '../../storage/database.ts';
import { hasArchivedRepositoryMarker } from '../archived-marker.ts';
import {
	type GitRepositoryProbeFn,
	type GitWorktreeProbeFn,
	probeGitRepository,
	probeGitWorktreeMetadata,
} from '../git-probe.ts';
import {
	appendBranchCollisionDiagnostics,
	trackBranchCollision,
} from './branch-collisions.ts';
import { emptySnapshot, type ReconcileSharedRootInput } from './internal.ts';
import {
	adoptRepositoryRow,
	findRepositoryByPath,
	findRepositoryBySlug,
	refreshRepositoryRow,
} from './repository-adoption.ts';
import { readChildDirectories } from './scan.ts';
import { detectStaleRecords } from './stale-detection.ts';
import {
	adoptWorkspaceRow,
	findWorkspaceByPath,
	refreshWorkspaceRow,
} from './workspace-adoption.ts';

/** Public surface of the shared-root adoption service. */
export interface SharedRootAdoptionService {
	reconcile: () => Promise<SharedRootAdoptionSnapshot>;
}

/** Options for {@link createSharedRootAdoptionService}. */
export interface CreateSharedRootAdoptionServiceOptions {
	databaseService: EnsembleDatabaseService;
	gitProbe?: GitRepositoryProbeFn;
	loadConfig?: (options: LoadRepositoryConfigOptions) => LoadedRepositoryConfig;
	now?: () => Date;
	rootDirectoryService: EnsembleRootDirectoryService;
	worktreeProbe?: GitWorktreeProbeFn;
}

/**
 * Builds the service that scans the configured shared root, adopts valid git
 * repositories and worktrees into SQLite, refreshes existing rows, and surfaces
 * stale records or collisions without touching unmanaged files.
 * @param options - Service dependencies and tuning overrides.
 * @returns A {@link SharedRootAdoptionService}.
 */
export function createSharedRootAdoptionService({
	databaseService,
	gitProbe = probeGitRepository,
	loadConfig = loadRepositoryConfig,
	now = () => new Date(),
	rootDirectoryService,
	worktreeProbe = probeGitWorktreeMetadata,
}: CreateSharedRootAdoptionServiceOptions): SharedRootAdoptionService {
	return {
		reconcile: async () => {
			const root =
				rootDirectoryService.getSnapshot() ?? rootDirectoryService.ensure();

			return reconcileSharedRoot({
				database: databaseService.getConnection()?.database ?? null,
				gitProbe,
				loadConfig,
				now,
				root,
				worktreeProbe,
			});
		},
	};
}

/**
 * Scans the shared root and reconciles SQLite with filesystem reality.
 *
 * The scan is idempotent: existing repository and workspace rows are
 * refreshed (last seen, branch, head) while new rows carry adoption metadata
 * so the UI can distinguish them from explicitly-created records. Unknown
 * directories and stale rows are flagged but never deleted.
 * @param input - Database, probes, config loader, clock, and root snapshot.
 * @returns A {@link SharedRootAdoptionSnapshot} describing the outcome.
 */
export async function reconcileSharedRoot({
	database,
	gitProbe,
	loadConfig,
	now,
	root,
	worktreeProbe,
}: ReconcileSharedRootInput): Promise<SharedRootAdoptionSnapshot> {
	const scannedAt = now().toISOString();
	const diagnostics: SharedRootAdoptionDiagnostic[] = [];

	if (!database) {
		diagnostics.push({
			code: 'database-unavailable',
			message: 'SQLite is unavailable; shared-root adoption was skipped.',
			severity: 'error',
		});
		return emptySnapshot({ diagnostics, root, scannedAt, status: 'error' });
	}

	if (
		root.status === 'error' ||
		!root.path ||
		!root.repositoriesPath ||
		!root.workspacesPath
	) {
		if (root.status === 'error') {
			diagnostics.push({
				code: 'root-unavailable',
				message: 'The managed root has errors; adoption was skipped.',
				path: root.path,
				severity: 'error',
			});
		} else {
			diagnostics.push({
				code: 'root-unavailable',
				message: 'The managed root is not configured; adoption was skipped.',
				severity: 'warning',
			});
		}
		return emptySnapshot({
			diagnostics,
			root,
			scannedAt,
			status: root.status === 'error' ? 'error' : 'warning',
		});
	}

	const adoptedRepositories: AdoptedRepositorySnapshot[] = [];
	const refreshedRepositoryIds: string[] = [];
	const scannedRepositoryPaths = new Set<string>();
	const repositoriesBySlug = new Map<
		string,
		{ defaultBranch: string | null; id: string; path: string; slug: string }
	>();

	const repositoryChildren = readChildDirectories(
		root.repositoriesPath,
		diagnostics,
		'repository-scan-failed',
	);
	for (const child of repositoryChildren) {
		const candidatePath = path.join(root.repositoriesPath, child);
		scannedRepositoryPaths.add(candidatePath);

		// Folders the user has explicitly archived carry a sentinel file. Skip
		// them so a restart never resurrects what the user just removed.
		if (hasArchivedRepositoryMarker(candidatePath)) {
			continue;
		}

		const probe = await gitProbe(candidatePath);

		if (!probe.isGitRepository || probe.topLevel !== candidatePath) {
			diagnostics.push({
				code: 'invalid-repository',
				message: probe.error ?? 'The directory is not a valid git repository.',
				path: candidatePath,
				severity: 'warning',
			});
			continue;
		}

		const existing = findRepositoryByPath(database, candidatePath);
		if (existing) {
			refreshRepositoryRow({
				database,
				id: existing.id,
				probe,
				timestamp: scannedAt,
			});
			refreshedRepositoryIds.push(existing.id);
			repositoriesBySlug.set(existing.slug, {
				defaultBranch: probe.defaultBranch ?? existing.defaultBranch,
				id: existing.id,
				path: candidatePath,
				slug: existing.slug,
			});
			continue;
		}

		const adopted = adoptRepositoryRow({
			candidatePath,
			database,
			loadConfig,
			now,
			probe,
			timestamp: scannedAt,
		});
		adoptedRepositories.push(adopted);
		repositoriesBySlug.set(adopted.slug, {
			defaultBranch: adopted.defaultBranch,
			id: adopted.id,
			path: candidatePath,
			slug: adopted.slug,
		});
	}

	const adoptedWorkspaces: AdoptedWorkspaceSnapshot[] = [];
	const refreshedWorkspaceIds: string[] = [];
	const scannedWorkspacePaths = new Set<string>();
	const collisionsByRepo = new Map<string, Map<string, string[]>>();

	const workspaceRepoChildren = readChildDirectories(
		root.workspacesPath,
		diagnostics,
		'workspace-scan-failed',
	);
	for (const repoSlug of workspaceRepoChildren) {
		const repoWorkspacesPath = path.join(root.workspacesPath, repoSlug);
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

		const workspaceChildren = readChildDirectories(
			repoWorkspacesPath,
			diagnostics,
			'workspace-scan-failed',
		);
		for (const workspaceSlug of workspaceChildren) {
			const candidatePath = path.join(repoWorkspacesPath, workspaceSlug);
			scannedWorkspacePaths.add(candidatePath);

			const probe = await worktreeProbe(candidatePath);
			if (!probe.isWorktree || probe.topLevel !== candidatePath) {
				diagnostics.push({
					code: 'invalid-worktree',
					message: probe.error ?? 'The directory is not a git worktree.',
					path: candidatePath,
					severity: 'warning',
				});
				continue;
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
			if (existing) {
				refreshWorkspaceRow({
					database,
					id: existing.id,
					probe,
					timestamp: scannedAt,
				});
				refreshedWorkspaceIds.push(existing.id);
				trackBranchCollision({
					branch: probe.headBranch,
					collisionsByRepo,
					id: existing.id,
					repositoryId: repoInfo.id,
				});
				continue;
			}

			const adopted = adoptWorkspaceRow({
				candidatePath,
				database,
				probe,
				repository: repoInfo,
				slug: workspaceSlug,
				timestamp: scannedAt,
			});
			adoptedWorkspaces.push(adopted);
			trackBranchCollision({
				branch: probe.headBranch,
				collisionsByRepo,
				id: adopted.id,
				repositoryId: repoInfo.id,
			});
		}
	}

	const stale = detectStaleRecords({
		database,
		rootRepositoriesPath: root.repositoriesPath,
		rootWorkspacesPath: root.workspacesPath,
		scannedRepositoryPaths,
		scannedWorkspacePaths,
		timestamp: scannedAt,
	});

	appendBranchCollisionDiagnostics({ collisionsByRepo, diagnostics });

	const status: SharedRootAdoptionStatus = diagnostics.some(
		(diagnostic) => diagnostic.severity === 'error',
	)
		? 'error'
		: diagnostics.length > 0
			? 'warning'
			: 'ok';

	return {
		adopted: {
			repositories: adoptedRepositories,
			workspaces: adoptedWorkspaces,
		},
		diagnostics,
		refreshed: {
			repositoryIds: refreshedRepositoryIds,
			workspaceIds: refreshedWorkspaceIds,
		},
		rootPath: root.path,
		scannedAt,
		stale,
		status,
	};
}
