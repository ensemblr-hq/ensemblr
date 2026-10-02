import path from 'node:path';

import type {
	SharedRootAdoptionDiagnostic,
	SharedRootAdoptionSnapshot,
	SharedRootAdoptionStatus,
} from '../../../shared/ipc/contracts/shared-root-adoption';
import {
	type LoadedRepositoryConfig,
	type LoadRepositoryConfigOptions,
	loadRepositoryConfig,
} from '../../config/repository-config.ts';
import type { EnsemblrRootDirectoryService } from '../../root';
import type { EnsemblrDatabaseService } from '../../storage/database.ts';
import {
	type GitRepositoryProbeFn,
	type GitWorktreeProbeFn,
	probeGitRepository,
	probeGitWorktreeMetadata,
} from '../git-probe.ts';
import { appendBranchCollisionDiagnostics } from './branch-collisions.ts';
import { emptySnapshot, type ReconcileSharedRootInput } from './internal.ts';
import { reconcileRepositories } from './repository-adoption.ts';
import { readChildDirectories } from './scan.ts';
import { detectStaleRecords } from './stale-detection.ts';
import { reconcileWorkspaces } from './workspace-adoption.ts';

/** Public surface of the shared-root adoption service. */
export interface SharedRootAdoptionService {
	reconcile: () => Promise<SharedRootAdoptionSnapshot>;
}

/** Options for {@link createSharedRootAdoptionService}. */
export interface CreateSharedRootAdoptionServiceOptions {
	databaseService: EnsemblrDatabaseService;
	gitProbe?: GitRepositoryProbeFn;
	loadConfig?: (options: LoadRepositoryConfigOptions) => LoadedRepositoryConfig;
	now?: () => Date;
	rootDirectoryService: EnsemblrRootDirectoryService;
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

	const workspaceRepoChildren = readChildDirectories(
		root.workspacesPath,
		diagnostics,
		'workspace-scan-failed',
	);
	const workspaceChildrenByRepository = new Map(
		workspaceRepoChildren.map((repositorySlug) => {
			const repositoryWorkspacesPath = path.join(
				root.workspacesPath,
				repositorySlug,
			);
			return [
				repositorySlug,
				readChildDirectories(
					repositoryWorkspacesPath,
					diagnostics,
					'workspace-scan-failed',
				),
			] as const;
		}),
	);

	const repositories = await reconcileRepositories({
		children: readChildDirectories(
			root.repositoriesPath,
			diagnostics,
			'repository-scan-failed',
		),
		database,
		diagnostics,
		gitProbe,
		loadConfig,
		now,
		repositoriesPath: root.repositoriesPath,
		timestamp: scannedAt,
	});

	const workspaces = await reconcileWorkspaces({
		childrenByRepository: workspaceChildrenByRepository,
		database,
		diagnostics,
		repositoriesBySlug: repositories.repositoriesBySlug,
		repositorySlugs: workspaceRepoChildren,
		timestamp: scannedAt,
		workspacesPath: root.workspacesPath,
		worktreeProbe,
	});

	const stale = detectStaleRecords({
		database,
		rootRepositoriesPath: root.repositoriesPath,
		rootWorkspacesPath: root.workspacesPath,
		scannedRepositoryPaths: repositories.scannedPaths,
		scannedWorkspacePaths: workspaces.scannedPaths,
		timestamp: scannedAt,
	});

	appendBranchCollisionDiagnostics({
		collisionsByRepo: workspaces.collisionsByRepo,
		diagnostics,
	});

	return {
		adopted: {
			repositories: repositories.adopted,
			workspaces: workspaces.adopted,
		},
		diagnostics,
		refreshed: {
			repositoryIds: repositories.refreshedIds,
			workspaceIds: workspaces.refreshedIds,
		},
		rootPath: root.path,
		scannedAt,
		stale,
		status: resolveAdoptionStatus(diagnostics),
	};
}

/**
 * Reduce the scan's diagnostics to the status the snapshot reports.
 * @param diagnostics - Every diagnostic the scan collected
 * @returns `error` when any diagnostic is fatal, `warning` when any exist, else `ok`
 */
function resolveAdoptionStatus(
	diagnostics: readonly SharedRootAdoptionDiagnostic[],
): SharedRootAdoptionStatus {
	if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
		return 'error';
	}
	return diagnostics.length > 0 ? 'warning' : 'ok';
}
