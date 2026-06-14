import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { AdoptedRepositorySnapshot } from '../../../shared/ipc/contracts/repository';
import {
	insertRepositoryRow,
	refreshRepositoryAdoptionRow,
	selectRepositoryIdBySlug,
	selectRepositoryLookupByPath,
	selectRepositoryLookupBySlug,
	selectRepositoryMetadataJson,
} from '../../storage/repositories/repository-row-repository.ts';
import type { GitRepositoryProbe } from '../git-probe.ts';
import { normalizeRemoteUrl } from '../github-url.ts';
import { parseMetadata } from '../metadata.ts';
import { toSlug } from '../slug.ts';
import { ADOPTION_MODE, type LoadConfigFn } from './internal.ts';

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
	const metadataJson = selectRepositoryMetadataJson({ database, id });
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
		remoteUrl: probe.remoteUrl ?? existing.remoteUrl ?? null,
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
