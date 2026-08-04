import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { RootDirectorySnapshot } from '../../../shared/ipc/contracts/root-directory';
import type {
	SharedRootAdoptionDiagnostic,
	SharedRootAdoptionSnapshot,
	SharedRootAdoptionStatus,
} from '../../../shared/ipc/contracts/shared-root-adoption';
import type {
	LoadedRepositoryConfig,
	LoadRepositoryConfigOptions,
} from '../../config';
import { updateRepositoryMetadataJson } from '../../storage/repositories/repository-row-repository.ts';
import { updateWorkspaceMetadataJson } from '../../storage/repositories/workspace-repository.ts';
import type { GitRepositoryProbeFn, GitWorktreeProbeFn } from '../git-probe.ts';
import { parseMetadata } from '../metadata.ts';

/** Sentinel string written into adoption metadata to tag discovered rows. */
export const ADOPTION_MODE = 'adopted-from-shared-root';

/** Lightweight view of a repository row needed by adoption helpers. */
export interface RepositoryAdoptionInfo {
	defaultBranch: string | null;
	id: string;
	path: string;
	slug: string;
}

/** Arguments shared across adoption sub-routines. */
export interface ReconcileSharedRootInput {
	database: DatabaseSync | null;
	gitProbe: GitRepositoryProbeFn;
	loadConfig: (options: LoadRepositoryConfigOptions) => LoadedRepositoryConfig;
	now: () => Date;
	root: RootDirectorySnapshot;
	worktreeProbe: GitWorktreeProbeFn;
}

/** Loads a repository's resolved config for the given options; injectable for tests. */
export type LoadConfigFn = (
	options: LoadRepositoryConfigOptions,
) => LoadedRepositoryConfig;

export type { LoadedRepositoryConfig };

/** Builds an empty snapshot used when adoption cannot proceed. */
export function emptySnapshot({
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

/**
 * Merge a patch into a row's `adoption` metadata bag, preserving every other
 * field a caller wrote earlier.
 * @param metadataJson - Stored metadata JSON, or undefined when the row has none
 * @param patch - Adoption fields to write over the stored ones
 * @returns The metadata object with its adoption bag patched
 */
export function patchAdoptionMetadata({
	metadataJson,
	patch,
}: {
	metadataJson: string | undefined;
	patch: Record<string, unknown>;
}): Record<string, unknown> {
	const existing = parseMetadata(metadataJson);
	return {
		...existing,
		adoption: { ...readAdoptionBag(existing), ...patch },
	};
}

/** Reads the `adoption` bag off parsed metadata, defaulting to an empty record. */
function readAdoptionBag(
	metadata: Record<string, unknown>,
): Record<string, unknown> {
	return typeof metadata.adoption === 'object' && metadata.adoption !== null
		? (metadata.adoption as Record<string, unknown>)
		: {};
}

/** Persists a `missingSince` flag onto a row's metadata without deleting it. */
export function markRecordMissing({
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
	if (readAdoptionBag(parseMetadata(metadataJson)).missingSince === timestamp) {
		return;
	}

	const nextMetadataJson = JSON.stringify(
		patchAdoptionMetadata({ metadataJson, patch: { missingSince: timestamp } }),
	);
	if (table === 'repositories') {
		updateRepositoryMetadataJson({
			database,
			id,
			metadataJson: nextMetadataJson,
		});
	} else {
		updateWorkspaceMetadataJson({
			database,
			id,
			metadataJson: nextMetadataJson,
		});
	}
}

/** Type guard for `SELECT id, path, metadata_json ...` rows. */
export function isPathRow(
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

/** Ensures the path ends with the platform path separator. */
export function ensureTrailingSeparator(directoryPath: string): string {
	return directoryPath.endsWith(path.sep)
		? directoryPath
		: `${directoryPath}${path.sep}`;
}
