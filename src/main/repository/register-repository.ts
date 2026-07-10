import { randomUUID } from 'node:crypto';
import { accessSync, constants, rmSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
	RegisteredRepositorySnapshot,
	RegisterLocalRepositoryDiagnostic,
	RegisterLocalRepositoryRequest,
	RegisterLocalRepositoryResult,
} from '../../shared/ipc/contracts/repository';
import type { RepositoryConfigSourceSnapshot } from '../../shared/ipc/contracts/repository-config';
import type {
	LoadedRepositoryConfig,
	LoadRepositoryConfigOptions,
} from '../config';
import { loadRepositoryConfig } from '../config/repository-config.ts';
import type { EnsemblrDatabaseService } from '../storage';
import {
	insertRepositoryRow as insertRepositoryRowStorage,
	selectRepositoryIdByPath,
	selectRepositoryIdByRemoteUrl,
	selectRepositoryIdBySlug,
} from '../storage/repositories/repository-row-repository.ts';
import { selectWorkspaceIdByPath } from '../storage/repositories/workspace-repository.ts';
import { withTransaction } from '../storage/tx.ts';
import { ARCHIVED_REPOSITORY_MARKER } from './archived-marker.ts';
import {
	type GitRepositoryProbe,
	type GitRepositoryProbeFn,
	probeGitRepository,
} from './git-probe.ts';
import { normalizeRemoteUrl } from './github-url.ts';
import { toSlug } from './slug.ts';

/** Public surface of the local repository registration service. */
export interface LocalRepositoryRegistrationService {
	register: (
		request: RegisterLocalRepositoryRequest,
	) => Promise<RegisterLocalRepositoryResult>;
}

/** Options for {@link createLocalRepositoryRegistrationService}. */
export interface CreateLocalRepositoryRegistrationServiceOptions {
	databaseService: EnsemblrDatabaseService;
	gitProbe?: GitRepositoryProbeFn;
	loadConfig?: (options: LoadRepositoryConfigOptions) => LoadedRepositoryConfig;
	now?: () => Date;
}

/** Internal: ready-to-insert repository record. */
interface PreparedRepository {
	defaultBranch: string | null;
	id: string;
	metadata: Record<string, unknown>;
	name: string;
	path: string;
	remoteUrl: string | null;
	slug: string;
}

/**
 * Builds the registration service the IPC layer delegates to when the user
 * picks a local folder.
 * @param options - Service dependencies and tuning overrides.
 * @returns A {@link LocalRepositoryRegistrationService}.
 */
export function createLocalRepositoryRegistrationService({
	databaseService,
	gitProbe = probeGitRepository,
	loadConfig = loadRepositoryConfig,
	now = () => new Date(),
}: CreateLocalRepositoryRegistrationServiceOptions): LocalRepositoryRegistrationService {
	return {
		register: async (request) => {
			const database = databaseService.getConnection()?.database;

			if (!database) {
				const rawPath = (request.path ?? '').trim();
				return failureResult([], {
					code: 'database-unavailable',
					message: 'SQLite is unavailable; the repository was not registered.',
					path: rawPath ? path.resolve(rawPath) : undefined,
					severity: 'error',
				});
			}

			return registerLocalRepository({
				database,
				gitProbe,
				loadConfig,
				now,
				request,
			});
		},
	};
}

/**
 * Validates the candidate path, probes it with git, loads its repository
 * configuration, and inserts a new row into the `repositories` table.
 * @param input - Dependencies and the registration request.
 * @returns A {@link RegisterLocalRepositoryResult} describing the outcome.
 */
export async function registerLocalRepository({
	database,
	gitProbe,
	loadConfig,
	now,
	request,
}: {
	database: DatabaseSync;
	gitProbe: GitRepositoryProbeFn;
	loadConfig: (options: LoadRepositoryConfigOptions) => LoadedRepositoryConfig;
	now: () => Date;
	request: RegisterLocalRepositoryRequest;
}): Promise<RegisterLocalRepositoryResult> {
	const diagnostics: RegisterLocalRepositoryDiagnostic[] = [];
	const rawPath = (request.path ?? '').trim();

	if (!rawPath) {
		return failureResult(diagnostics, {
			code: 'repository-path-missing',
			message: 'No repository path was provided.',
			severity: 'error',
		});
	}

	if (!path.isAbsolute(rawPath)) {
		return failureResult(diagnostics, {
			code: 'repository-path-relative',
			message: 'The repository path must be absolute.',
			severity: 'error',
			path: rawPath,
		});
	}

	const repositoryPath = path.resolve(rawPath);

	const writableDiagnostic = assertWritablePath(repositoryPath);

	if (writableDiagnostic) {
		return failureResult(diagnostics, writableDiagnostic);
	}

	const probe = await gitProbe(repositoryPath);

	if (!probe.isGitRepository) {
		return failureResult(diagnostics, {
			code: 'path-not-a-git-repository',
			message: probe.error ?? 'The selected path is not a git repository.',
			path: repositoryPath,
			severity: 'error',
		});
	}

	const existingDiagnostic = findExistingDuplicate(
		database,
		repositoryPath,
		probe.remoteUrl,
	);

	if (existingDiagnostic) {
		return failureResult(diagnostics, existingDiagnostic);
	}

	const loadedConfig = loadConfig({ now, repositoryPath });
	const settingsSources = loadedConfig.snapshot.sources;
	const timestamp = now().toISOString();
	const nameOverride =
		typeof request.name === 'string' ? request.name.trim() : '';
	const prepared = prepareRepositoryRecord({
		database,
		nameOverride: nameOverride || undefined,
		probe,
		repositoryPath,
		settingsSources,
		timestamp,
	});

	try {
		withTransaction(database, () => {
			insertRepositoryRow({ database, prepared, timestamp });
		});
	} catch (error) {
		return failureResult(diagnostics, {
			code: 'repository-insert-failed',
			message:
				error instanceof Error
					? error.message
					: 'Failed to write the repository record to SQLite.',
			path: repositoryPath,
			severity: 'error',
		});
	}

	// User re-adding a previously-archived folder is an explicit "un-archive"
	// — drop the marker so future restarts adopt this repo normally.
	try {
		rmSync(path.join(repositoryPath, ARCHIVED_REPOSITORY_MARKER), {
			force: true,
		});
	} catch {
		// Non-fatal: registration already succeeded.
	}

	const repository: RegisteredRepositorySnapshot = {
		createdAt: timestamp,
		defaultBranch: prepared.defaultBranch,
		id: prepared.id,
		metadata: prepared.metadata,
		name: prepared.name,
		path: prepared.path,
		remoteUrl: prepared.remoteUrl,
		slug: prepared.slug,
		updatedAt: timestamp,
	};

	return {
		diagnostics,
		registered: true,
		repository,
		settingsSources,
	};
}

/**
 * Verifies the candidate path is readable and writable; returns a diagnostic
 * when not (caller turns it into a failure result).
 */
function assertWritablePath(
	repositoryPath: string,
): RegisterLocalRepositoryDiagnostic | null {
	try {
		accessSync(repositoryPath, constants.R_OK | constants.W_OK);
		return null;
	} catch (error) {
		const code = isPermissionError(error)
			? 'repository-permission-denied'
			: 'repository-path-unreadable';

		return {
			code,
			message:
				error instanceof Error
					? error.message
					: 'Failed to access the repository path.',
			path: repositoryPath,
			severity: 'error',
		};
	}
}

/**
 * Returns a duplicate diagnostic when the path, the path-as-workspace, or the
 * upstream remote URL is already tracked. The remote-URL check is what blocks
 * a user from cloning the same GitHub repo twice into different folders.
 */
function findExistingDuplicate(
	database: DatabaseSync,
	repositoryPath: string,
	remoteUrl: string | null,
): RegisterLocalRepositoryDiagnostic | null {
	if (selectRepositoryIdByPath({ database, repositoryPath })) {
		return {
			code: 'repository-already-registered',
			message: 'This repository is already registered with Ensemblr.',
			path: repositoryPath,
			severity: 'error',
		};
	}

	if (selectWorkspaceIdByPath({ database, workspacePath: repositoryPath })) {
		return {
			code: 'repository-path-is-workspace',
			message:
				'This path is already tracked as a workspace; pick the parent repository instead.',
			path: repositoryPath,
			severity: 'error',
		};
	}

	if (isRemoteUrlTracked(database, remoteUrl)) {
		return {
			code: 'repository-remote-already-registered',
			message:
				'Another registered repository already tracks this remote. Remove it before re-adding.',
			path: repositoryPath,
			severity: 'error',
		};
	}

	return null;
}

/**
 * Returns true when any registered repository's metadata `remoteUrl` matches
 * `candidate` after canonicalisation. Exported so the clone service can
 * pre-flight the same check before it spawns `git`.
 */
export function isRemoteUrlTracked(
	database: DatabaseSync,
	candidate: string | null,
): boolean {
	const normalized = normalizeRemoteUrl(candidate);
	if (!normalized) {
		return false;
	}
	return (
		selectRepositoryIdByRemoteUrl({ database, remoteUrl: normalized }) !== null
	);
}

/**
 * Builds the ready-to-insert repository record, allocating a unique slug and
 * capturing settings-source diagnostics into `metadata_json`.
 */
function prepareRepositoryRecord({
	database,
	nameOverride,
	probe,
	repositoryPath,
	settingsSources,
	timestamp,
}: {
	database: DatabaseSync;
	nameOverride: string | undefined;
	probe: GitRepositoryProbe;
	repositoryPath: string;
	settingsSources: RepositoryConfigSourceSnapshot[];
	timestamp: string;
}): PreparedRepository {
	const baseName =
		nameOverride && nameOverride.length > 0
			? nameOverride
			: path.basename(repositoryPath) || 'repository';
	const slug = allocateUniqueSlug(database, baseName);
	const metadata: Record<string, unknown> = {
		adoptionMode: 'adopt-in-place',
		registeredAt: timestamp,
		remoteUrl: probe.remoteUrl,
		settingsSources: settingsSources.map((source) => ({
			displayPath: source.displayPath,
			path: source.path,
			source: source.source,
			status: source.status,
		})),
	};

	return {
		defaultBranch: probe.defaultBranch,
		id: `repository-${randomUUID()}`,
		metadata,
		name: baseName,
		path: repositoryPath,
		remoteUrl: probe.remoteUrl,
		slug,
	};
}

/**
 * Inserts a `repositories` row, with `metadata_json` capturing remote URL,
 * adoption mode, and the settings-source diagnostics surface from ENS-015.
 */
function insertRepositoryRow({
	database,
	prepared,
	timestamp,
}: {
	database: DatabaseSync;
	prepared: PreparedRepository;
	timestamp: string;
}): void {
	insertRepositoryRowStorage({
		database,
		defaultBranch: prepared.defaultBranch,
		id: prepared.id,
		metadataJson: JSON.stringify(prepared.metadata),
		name: prepared.name,
		path: prepared.path,
		remoteUrl: normalizeRemoteUrl(prepared.remoteUrl) ?? '',
		slug: prepared.slug,
		timestamp,
	});
}

/**
 * Produces a slug that does not collide with any existing repository slug,
 * suffixing `-2`, `-3`, ... until a free slot is found.
 */
function allocateUniqueSlug(database: DatabaseSync, baseName: string): string {
	const baseSlug = toRepositorySlug(baseName);
	let candidate = baseSlug;
	let suffix = 2;

	while (slugExists(database, candidate)) {
		candidate = `${baseSlug}-${suffix}`;
		suffix += 1;
	}

	return candidate;
}

/** Tests whether a slug is already taken by an existing repository row. */
function slugExists(database: DatabaseSync, slug: string): boolean {
	return selectRepositoryIdBySlug({ database, slug }) !== null;
}

/** Normalises a candidate name into a URL-safe slug with stable fallback. */
function toRepositorySlug(value: string): string {
	return toSlug(value, 'repository');
}

/** Builds the failure shape returned for any rejected registration request. */
function failureResult(
	diagnostics: RegisterLocalRepositoryDiagnostic[],
	diagnostic: RegisterLocalRepositoryDiagnostic,
): RegisterLocalRepositoryResult {
	return {
		diagnostics: [...diagnostics, diagnostic],
		registered: false,
		repository: null,
		settingsSources: [],
	};
}

/** Tests whether a Node.js filesystem error is a permission failure. */
function isPermissionError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error.code === 'EACCES' || error.code === 'EPERM')
	);
}
