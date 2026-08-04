import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { AdoptedRepositorySnapshot } from '../../../shared/ipc/contracts/repository';
import type { SharedRootAdoptionDiagnostic } from '../../../shared/ipc/contracts/shared-root-adoption';
import {
	insertRepositoryRow,
	refreshRepositoryAdoptionRow,
	selectRepositoryIdBySlug,
	selectRepositoryLookupByPath,
	selectRepositoryLookupBySlug,
	selectRepositoryMetadataJson,
} from '../../storage/repositories/repository-row-repository.ts';
import { hasArchivedRepositoryMarker } from '../archived-marker.ts';
import type { GitRepositoryProbe, GitRepositoryProbeFn } from '../git-probe.ts';
import { normalizeRemoteUrl } from '../github-url.ts';
import { toSlug } from '../slug.ts';
import {
	ADOPTION_MODE,
	type LoadConfigFn,
	patchAdoptionMetadata,
	type RepositoryAdoptionInfo,
} from './internal.ts';

/**
 * What one pass over the shared root's repositories produced: newly adopted
 * rows, refreshed row ids, the slug index workspace adoption resolves against,
 * and every path the scan visited.
 */
export interface RepositoryReconciliation {
	adopted: AdoptedRepositorySnapshot[];
	refreshedIds: string[];
	repositoriesBySlug: Map<string, RepositoryAdoptionInfo>;
	scannedPaths: Set<string>;
}

/**
 * Probe every child of the shared root's repositories directory and reconcile
 * SQLite with what is on disk, adopting new git repositories and refreshing
 * known ones. Directories the user archived carry a sentinel file and are
 * skipped so a restart never resurrects what they just removed.
 * @param children - Directory names directly under the repositories root
 * @param database - Open database handle
 * @param diagnostics - Collector the adoption snapshot reports through
 * @param gitProbe - Probe that inspects a candidate directory as a git repository
 * @param loadConfig - Loads a repository's resolved config for adoption metadata
 * @param now - Clock used for config resolution
 * @param repositoriesPath - Absolute path of the repositories root
 * @param timestamp - Scan timestamp stamped onto adopted and refreshed rows
 * @returns The reconciliation outcome for the repositories layer
 */
export async function reconcileRepositories({
	children,
	database,
	diagnostics,
	gitProbe,
	loadConfig,
	now,
	repositoriesPath,
	timestamp,
}: {
	children: readonly string[];
	database: DatabaseSync;
	diagnostics: SharedRootAdoptionDiagnostic[];
	gitProbe: GitRepositoryProbeFn;
	loadConfig: LoadConfigFn;
	now: () => Date;
	repositoriesPath: string;
	timestamp: string;
}): Promise<RepositoryReconciliation> {
	const probes = await Promise.all(
		children.map(async (child) => {
			const candidatePath = path.join(repositoriesPath, child);
			if (hasArchivedRepositoryMarker(candidatePath)) {
				return { archived: true as const, candidatePath };
			}
			return {
				archived: false as const,
				candidatePath,
				probe: await gitProbe(candidatePath),
			};
		}),
	);

	const outcome: RepositoryReconciliation = {
		adopted: [],
		refreshedIds: [],
		repositoriesBySlug: new Map(),
		scannedPaths: new Set(),
	};

	for (const entry of probes) {
		const { candidatePath } = entry;
		outcome.scannedPaths.add(candidatePath);

		if (entry.archived) {
			continue;
		}

		const { probe } = entry;
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
			refreshRepositoryRow({ database, id: existing.id, probe, timestamp });
			outcome.refreshedIds.push(existing.id);
			outcome.repositoriesBySlug.set(existing.slug, {
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
			timestamp,
		});
		outcome.adopted.push(adopted);
		outcome.repositoriesBySlug.set(adopted.slug, {
			defaultBranch: adopted.defaultBranch,
			id: adopted.id,
			path: candidatePath,
			slug: adopted.slug,
		});
	}

	return outcome;
}

/** Loads the repository row matching `repositoryPath`, if any. */
export function findRepositoryByPath(
	database: DatabaseSync,
	repositoryPath: string,
): { defaultBranch: string | null; id: string; slug: string } | null {
	const row = selectRepositoryLookupByPath({ database, repositoryPath });

	if (!isRepositoryLookupRow(row)) {
		return null;
	}
	return row;
}

/** Loads the repository row matching `slug`, if any. */
export function findRepositoryBySlug(
	database: DatabaseSync,
	slug: string,
): {
	defaultBranch: string | null;
	id: string;
	path: string;
	slug: string;
} | null {
	const row = selectRepositoryLookupBySlug({ database, slug });

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

/**
 * Refreshes `metadata_json.adoption.lastSeenAt` and `updated_at` for an
 * existing repository row, preserving any fields callers wrote earlier.
 */
export function refreshRepositoryRow({
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
	const refreshed = patchAdoptionMetadata({
		metadataJson: selectRepositoryMetadataJson({ database, id }) ?? undefined,
		patch: { lastSeenAt: timestamp },
	});
	const nextMetadata = {
		...refreshed,
		remoteUrl: probe.remoteUrl ?? refreshed.remoteUrl ?? null,
	};

	refreshRepositoryAdoptionRow({
		database,
		defaultBranch: probe.defaultBranch,
		id,
		metadataJson: JSON.stringify(nextMetadata),
		timestamp,
	});
}

/**
 * Inserts a new repository row carrying adoption metadata so callers can
 * distinguish discovered records from explicitly-registered ones.
 */
export function adoptRepositoryRow({
	candidatePath,
	database,
	loadConfig,
	now,
	probe,
	timestamp,
}: {
	candidatePath: string;
	database: DatabaseSync;
	loadConfig: LoadConfigFn;
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

	insertRepositoryRow({
		database,
		defaultBranch: probe.defaultBranch,
		id,
		metadataJson: JSON.stringify(metadata),
		name: baseName,
		path: candidatePath,
		remoteUrl: normalizeRemoteUrl(probe.remoteUrl) ?? '',
		slug,
		timestamp,
	});

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
	return selectRepositoryIdBySlug({ database, slug }) !== null;
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
