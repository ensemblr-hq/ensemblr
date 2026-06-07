import { randomUUID } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type {
	RegisteredRepositorySnapshot,
	RegisterLocalRepositoryDiagnostic,
	RegisterLocalRepositoryRequest,
	RegisterLocalRepositoryResult,
	RepositoryConfigSourceSnapshot,
} from '../../shared/ipc';
import {
	type LoadedRepositoryConfig,
	type LoadRepositoryConfigOptions,
	loadRepositoryConfig,
} from '../config/repository-config.ts';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import {
	type GitRepositoryProbe,
	type GitRepositoryProbeFn,
	probeGitRepository,
} from './git-probe.ts';

/** Public surface of the local repository registration service. */
export interface LocalRepositoryRegistrationService {
	register: (
		request: RegisterLocalRepositoryRequest,
	) => Promise<RegisterLocalRepositoryResult>;
}

/** Options for {@link createLocalRepositoryRegistrationService}. */
export interface CreateLocalRepositoryRegistrationServiceOptions {
	databaseService: EnsembleDatabaseService;
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

	const existingDiagnostic = findExistingDuplicate(database, repositoryPath);

	if (existingDiagnostic) {
		return failureResult(diagnostics, existingDiagnostic);
	}

	const loadedConfig = loadConfig({ now, repositoryPath });
	const settingsSources = loadedConfig.snapshot.sources;
	const timestamp = now().toISOString();
	const prepared = prepareRepositoryRecord({
		database,
		probe,
		repositoryPath,
		settingsSources,
		timestamp,
	});

	try {
		database.exec('BEGIN');
		try {
			insertRepositoryRow({ database, prepared, timestamp });
			database.exec('COMMIT');
		} catch (error) {
			database.exec('ROLLBACK');
			throw error;
		}
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
 * Returns a duplicate diagnostic when the path is already tracked as a
 * repository or workspace.
 */
function findExistingDuplicate(
	database: DatabaseSync,
	repositoryPath: string,
): RegisterLocalRepositoryDiagnostic | null {
	const repositoryRow = database
		.prepare('SELECT id FROM repositories WHERE path = ?')
		.get(repositoryPath);

	if (isIdRow(repositoryRow)) {
		return {
			code: 'repository-already-registered',
			message: 'This repository is already registered with Ensemble.',
			path: repositoryPath,
			severity: 'error',
		};
	}

	const workspaceRow = database
		.prepare('SELECT id FROM workspaces WHERE path = ?')
		.get(repositoryPath);

	if (isIdRow(workspaceRow)) {
		return {
			code: 'repository-path-is-workspace',
			message:
				'This path is already tracked as a workspace; pick the parent repository instead.',
			path: repositoryPath,
			severity: 'error',
		};
	}

	return null;
}

/**
 * Builds the ready-to-insert repository record, allocating a unique slug and
 * capturing settings-source diagnostics into `metadata_json`.
 */
function prepareRepositoryRecord({
	database,
	probe,
	repositoryPath,
	settingsSources,
	timestamp,
}: {
	database: DatabaseSync;
	probe: GitRepositoryProbe;
	repositoryPath: string;
	settingsSources: RepositoryConfigSourceSnapshot[];
	timestamp: string;
}): PreparedRepository {
	const baseName = path.basename(repositoryPath) || 'repository';
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
 * adoption mode, and the settings-source diagnostics surface from PID-015.
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
				metadata_json
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			prepared.id,
			prepared.slug,
			prepared.name,
			prepared.path,
			prepared.defaultBranch,
			timestamp,
			timestamp,
			JSON.stringify(prepared.metadata),
		);
}

/**
 * Produces a slug that does not collide with any existing repository slug,
 * suffixing `-2`, `-3`, ... until a free slot is found.
 */
function allocateUniqueSlug(database: DatabaseSync, baseName: string): string {
	const baseSlug = toSlug(baseName);
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
	const row = database
		.prepare('SELECT id FROM repositories WHERE slug = ?')
		.get(slug);

	return isIdRow(row);
}

/** Normalises a candidate name into a URL-safe slug with stable fallback. */
function toSlug(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	return slug || 'repository';
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

/** Type guard for `SELECT id FROM ...` rows used by the lookups above. */
function isIdRow(row: unknown): row is { id: string } {
	return (
		typeof row === 'object' &&
		row !== null &&
		'id' in row &&
		typeof (row as { id: unknown }).id === 'string'
	);
}
