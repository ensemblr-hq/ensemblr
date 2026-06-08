import { randomUUID } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type {
	AdoptedRepositorySnapshot,
	AdoptedWorkspaceSnapshot,
	RootDirectorySnapshot,
	SharedRootAdoptionDiagnostic,
	SharedRootAdoptionSnapshot,
	SharedRootAdoptionStaleRepositoryRecord,
	SharedRootAdoptionStaleWorkspaceRecord,
	SharedRootAdoptionStatus,
} from '../../shared/ipc';
import {
	type LoadedRepositoryConfig,
	type LoadRepositoryConfigOptions,
	loadRepositoryConfig,
} from '../config/repository-config.ts';
import type { EnsembleRootDirectoryService } from '../root';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import { hasArchivedRepositoryMarker } from './archived-marker.ts';
import { DEFAULT_FALLBACK_BRANCH } from './git-ops.ts';
import {
	type GitRepositoryProbe,
	type GitRepositoryProbeFn,
	type GitWorktreeMetadata,
	type GitWorktreeProbeFn,
	probeGitRepository,
	probeGitWorktreeMetadata,
} from './git-probe.ts';
import { parseMetadata } from './metadata.ts';
import { normalizeRemoteUrl } from './register-repository.ts';
import { toSlug } from './slug.ts';
import { deleteWorkspaceRow } from './workspace-row-ops.ts';

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

const ADOPTION_MODE = 'adopted-from-shared-root';

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
}: {
	database: DatabaseSync | null;
	gitProbe: GitRepositoryProbeFn;
	loadConfig: (options: LoadRepositoryConfigOptions) => LoadedRepositoryConfig;
	now: () => Date;
	root: RootDirectorySnapshot;
	worktreeProbe: GitWorktreeProbeFn;
}): Promise<SharedRootAdoptionSnapshot> {
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

	for (const [repositoryId, byBranch] of collisionsByRepo) {
		for (const [branch, ids] of byBranch) {
			if (ids.length > 1) {
				diagnostics.push({
					code: 'workspace-branch-collision',
					message: `Multiple workspaces in repository ${repositoryId} share branch "${branch}".`,
					severity: 'warning',
				});
			}
		}
	}

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

/**
 * Lists immediate subdirectory names under `directoryPath`, surfacing
 * read errors as diagnostics so the parent scan can continue gracefully.
 */
function readChildDirectories(
	directoryPath: string,
	diagnostics: SharedRootAdoptionDiagnostic[],
	failureCode: SharedRootAdoptionDiagnostic['code'],
): string[] {
	let entries: string[];

	try {
		entries = readdirSync(directoryPath).sort();
	} catch (error) {
		diagnostics.push({
			code: failureCode,
			message:
				error instanceof Error
					? error.message
					: 'Failed to read directory during shared-root adoption.',
			path: directoryPath,
			severity: 'warning',
		});
		return [];
	}

	const directories: string[] = [];

	for (const entry of entries) {
		if (entry.startsWith('.')) {
			continue;
		}
		const entryPath = path.join(directoryPath, entry);

		try {
			if (statSync(entryPath).isDirectory()) {
				directories.push(entry);
			}
		} catch {
			// Skip unreadable entries; the higher-level scan reports the path on later attempts.
		}
	}

	return directories;
}

/** Loads the repository row matching `repositoryPath`, if any. */
function findRepositoryByPath(
	database: DatabaseSync,
	repositoryPath: string,
): { defaultBranch: string | null; id: string; slug: string } | null {
	const row = database
		.prepare(
			'SELECT id, slug, default_branch AS defaultBranch FROM repositories WHERE path = ?',
		)
		.get(repositoryPath);

	if (!isRepositoryLookupRow(row)) {
		return null;
	}
	return row;
}

/** Loads the repository row matching `slug`, if any. */
function findRepositoryBySlug(
	database: DatabaseSync,
	slug: string,
): {
	defaultBranch: string | null;
	id: string;
	path: string;
	slug: string;
} | null {
	const row = database
		.prepare(
			'SELECT id, path, slug, default_branch AS defaultBranch FROM repositories WHERE slug = ?',
		)
		.get(slug);

	if (
		typeof row !== 'object' ||
		row === null ||
		typeof (row as Record<string, unknown>).id !== 'string' ||
		typeof (row as Record<string, unknown>).path !== 'string' ||
		typeof (row as Record<string, unknown>).slug !== 'string'
	) {
		return null;
	}
	const candidate = row as {
		defaultBranch: string | null;
		id: string;
		path: string;
		slug: string;
	};
	return {
		defaultBranch:
			typeof candidate.defaultBranch === 'string'
				? candidate.defaultBranch
				: null,
		id: candidate.id,
		path: candidate.path,
		slug: candidate.slug,
	};
}

/** Loads the workspace row matching `workspacePath`, if any. */
function findWorkspaceByPath(
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
 * Refreshes `metadata_json.adoption.lastSeenAt` and `updated_at` for an
 * existing repository row, preserving any fields callers wrote earlier.
 */
function refreshRepositoryRow({
	database,
	id,
	probe,
	timestamp,
}: {
	database: DatabaseSync;
	id: string;
	probe: GitRepositoryProbe;
	timestamp: string;
}): void {
	const row = database
		.prepare(
			'SELECT metadata_json AS metadataJson FROM repositories WHERE id = ?',
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
		remoteUrl: probe.remoteUrl ?? existing.remoteUrl ?? null,
	};

	database
		.prepare(
			`UPDATE repositories
				SET updated_at = ?,
					default_branch = COALESCE(?, default_branch),
					metadata_json = ?
				WHERE id = ?`,
		)
		.run(timestamp, probe.defaultBranch, JSON.stringify(nextMetadata), id);
}

/**
 * Inserts a new repository row carrying adoption metadata so callers can
 * distinguish discovered records from explicitly-registered ones.
 */
function adoptRepositoryRow({
	candidatePath,
	database,
	loadConfig,
	now,
	probe,
	timestamp,
}: {
	candidatePath: string;
	database: DatabaseSync;
	loadConfig: (options: LoadRepositoryConfigOptions) => LoadedRepositoryConfig;
	now: () => Date;
	probe: GitRepositoryProbe;
	timestamp: string;
}): AdoptedRepositorySnapshot {
	const baseName = path.basename(candidatePath) || 'repository';
	const slug = allocateRepositorySlug(database, baseName);
	const loadedConfig = loadConfig({ now, repositoryPath: candidatePath });
	const id = `repository-${randomUUID()}`;
	const metadata: Record<string, unknown> = {
		adoption: {
			adoptedAt: timestamp,
			lastSeenAt: timestamp,
			origin: 'shared-root',
		},
		adoptionMode: ADOPTION_MODE,
		remoteUrl: probe.remoteUrl,
		settingsSources: loadedConfig.snapshot.sources.map((source) => ({
			displayPath: source.displayPath,
			path: source.path,
			source: source.source,
			status: source.status,
		})),
	};

	database
		.prepare(
			`INSERT INTO repositories (
				id,
				slug,
				name,
				path,
				default_branch,
				created_at,
				updated_at,
				metadata_json,
				remote_url
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			slug,
			baseName,
			candidatePath,
			probe.defaultBranch,
			timestamp,
			timestamp,
			JSON.stringify(metadata),
			normalizeRemoteUrl(probe.remoteUrl) ?? '',
		);

	return {
		adoptedAt: timestamp,
		createdAt: timestamp,
		defaultBranch: probe.defaultBranch,
		id,
		metadata,
		name: baseName,
		path: candidatePath,
		remoteUrl: probe.remoteUrl,
		slug,
		updatedAt: timestamp,
	};
}

/** Produces a slug that does not collide with any existing repository slug. */
function allocateRepositorySlug(
	database: DatabaseSync,
	baseName: string,
): string {
	const baseSlug = toSlug(baseName) || 'repository';
	let candidate = baseSlug;
	let suffix = 2;

	while (repositorySlugExists(database, candidate)) {
		candidate = `${baseSlug}-${suffix}`;
		suffix += 1;
	}

	return candidate;
}

/** Tests whether a repository slug is already taken. */
function repositorySlugExists(database: DatabaseSync, slug: string): boolean {
	const row = database
		.prepare('SELECT id FROM repositories WHERE slug = ?')
		.get(slug);

	return (
		typeof row === 'object' &&
		row !== null &&
		typeof (row as Record<string, unknown>).id === 'string'
	);
}

/**
 * Refreshes an existing workspace row to reflect the current branch and head
 * observed on disk, updating adoption tracking fields without overwriting any
 * other metadata.
 */
function refreshWorkspaceRow({
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
function adoptWorkspaceRow({
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

/**
 * Reconciles repository/workspace rows whose filesystem path no longer exists
 * under the managed root.
 *
 * Repository rows are conservative: a missing repo directory may be the result
 * of an unmounted drive or a moved checkout, so the row is preserved with a
 * `missingSince` marker. Workspace rows are aggressive: a workspace lives in
 * the managed workspaces directory and is meant to be cheap to recreate, so a
 * vanished folder is treated as an out-of-band archive and the SQLite row is
 * deleted to keep the sidebar in sync with disk.
 */
function detectStaleRecords({
	database,
	rootRepositoriesPath,
	rootWorkspacesPath,
	scannedRepositoryPaths,
	scannedWorkspacePaths,
	timestamp,
}: {
	database: DatabaseSync;
	rootRepositoriesPath: string;
	rootWorkspacesPath: string;
	scannedRepositoryPaths: Set<string>;
	scannedWorkspacePaths: Set<string>;
	timestamp: string;
}): {
	repositories: SharedRootAdoptionStaleRepositoryRecord[];
	workspaces: SharedRootAdoptionStaleWorkspaceRecord[];
} {
	const repositoriesPathPrefix = ensureTrailingSeparator(rootRepositoriesPath);
	const workspacesPathPrefix = ensureTrailingSeparator(rootWorkspacesPath);

	const repoRows = database
		.prepare(
			"SELECT id, path, metadata_json AS metadataJson FROM repositories WHERE path LIKE ? || '%'",
		)
		.all(repositoriesPathPrefix);
	const wsRows = database
		.prepare(
			"SELECT id, path, metadata_json AS metadataJson FROM workspaces WHERE path LIKE ? || '%'",
		)
		.all(workspacesPathPrefix);

	const repositories: SharedRootAdoptionStaleRepositoryRecord[] = [];
	for (const row of repoRows) {
		if (!isPathRow(row)) {
			continue;
		}
		if (!row.path.startsWith(repositoriesPathPrefix)) {
			continue;
		}
		if (scannedRepositoryPaths.has(row.path)) {
			continue;
		}
		markRecordMissing({
			database,
			id: row.id,
			metadataJson: row.metadataJson,
			table: 'repositories',
			timestamp,
		});
		repositories.push({ id: row.id, missingSince: timestamp, path: row.path });
	}

	const workspaces: SharedRootAdoptionStaleWorkspaceRecord[] = [];
	for (const row of wsRows) {
		if (!isPathRow(row)) {
			continue;
		}
		if (!row.path.startsWith(workspacesPathPrefix)) {
			continue;
		}
		if (scannedWorkspacePaths.has(row.path)) {
			continue;
		}
		deleteWorkspaceRow({ database, id: row.id });
		workspaces.push({ id: row.id, missingSince: timestamp, path: row.path });
	}

	return { repositories, workspaces };
}

/** Persists a `missingSince` flag onto a row's metadata without deleting it. */
function markRecordMissing({
	database,
	id,
	metadataJson,
	table,
	timestamp,
}: {
	database: DatabaseSync;
	id: string;
	metadataJson: string;
	table: 'repositories' | 'workspaces';
	timestamp: string;
}): void {
	const existing = parseMetadata(metadataJson);
	const adoption =
		typeof existing.adoption === 'object' && existing.adoption !== null
			? (existing.adoption as Record<string, unknown>)
			: {};

	if (adoption.missingSince === timestamp) {
		return;
	}

	const nextMetadata = {
		...existing,
		adoption: {
			...adoption,
			missingSince: timestamp,
		},
	};

	database
		.prepare(
			table === 'repositories'
				? 'UPDATE repositories SET metadata_json = ? WHERE id = ?'
				: 'UPDATE workspaces SET metadata_json = ? WHERE id = ?',
		)
		.run(JSON.stringify(nextMetadata), id);
}

/** Groups workspace ids by branch name to surface collision diagnostics. */
function trackBranchCollision({
	branch,
	collisionsByRepo,
	id,
	repositoryId,
}: {
	branch: string | null;
	collisionsByRepo: Map<string, Map<string, string[]>>;
	id: string;
	repositoryId: string;
}): void {
	if (!branch) {
		return;
	}
	let byBranch = collisionsByRepo.get(repositoryId);
	if (!byBranch) {
		byBranch = new Map();
		collisionsByRepo.set(repositoryId, byBranch);
	}
	const ids = byBranch.get(branch);
	if (ids) {
		ids.push(id);
	} else {
		byBranch.set(branch, [id]);
	}
}

/** Builds an empty snapshot used when adoption cannot proceed. */
function emptySnapshot({
	diagnostics,
	root,
	scannedAt,
	status,
}: {
	diagnostics: SharedRootAdoptionDiagnostic[];
	root: RootDirectorySnapshot;
	scannedAt: string;
	status: SharedRootAdoptionStatus;
}): SharedRootAdoptionSnapshot {
	return {
		adopted: { repositories: [], workspaces: [] },
		diagnostics,
		refreshed: { repositoryIds: [], workspaceIds: [] },
		rootPath: root.path,
		scannedAt,
		stale: { repositories: [], workspaces: [] },
		status,
	};
}

/** Ensures the path ends with the platform path separator. */
function ensureTrailingSeparator(directoryPath: string): string {
	return directoryPath.endsWith(path.sep)
		? directoryPath
		: `${directoryPath}${path.sep}`;
}

/** Type guard for repository lookup rows. */
function isRepositoryLookupRow(
	row: unknown,
): row is { defaultBranch: string | null; id: string; slug: string } {
	if (typeof row !== 'object' || row === null) {
		return false;
	}
	const candidate = row as Record<string, unknown>;
	const defaultBranchOk =
		candidate.defaultBranch === null ||
		typeof candidate.defaultBranch === 'string';
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.slug === 'string' &&
		defaultBranchOk
	);
}

/** Type guard for `SELECT id, path, metadata_json ...` rows. */
function isPathRow(
	row: unknown,
): row is { id: string; metadataJson: string; path: string } {
	if (typeof row !== 'object' || row === null) {
		return false;
	}
	const candidate = row as Record<string, unknown>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.path === 'string' &&
		typeof candidate.metadataJson === 'string'
	);
}
