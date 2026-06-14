import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { RootDirectorySnapshot } from '../../../shared/ipc/contracts/root-directory';
import type { SharedRootAdoptionDiagnostic, SharedRootAdoptionSnapshot, SharedRootAdoptionStatus } from '../../../shared/ipc/contracts/shared-root-adoption';
import type {
	LoadedRepositoryConfig,
	LoadRepositoryConfigOptions,
} from '../../config/repository-config.ts';
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

	const nextMetadataJson = JSON.stringify(nextMetadata);
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
