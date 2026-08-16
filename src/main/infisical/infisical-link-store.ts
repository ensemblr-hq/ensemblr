import type { DatabaseSync } from 'node:sqlite';

import type { InfisicalLinkScope } from '../../shared/ipc/contracts/infisical';

/** Per-machine half of a link: which account resolves it, and when it last synced. */
export interface InfisicalLinkRow {
	accountId: string | null;
	enabled: boolean;
	environmentSlug: string;
	lastSyncedAt: string | null;
	projectId: string;
	projectName: string | null;
	recursive: boolean;
	scope: InfisicalLinkScope;
	scopeId: string;
	secretPath: string;
	siteUrl: string | null;
}

/** Fields accepted when creating or replacing a link row. */
export interface WriteInfisicalLinkInput {
	accountId: string | null;
	enabled: boolean;
	environmentSlug: string;
	projectId: string;
	projectName: string | null;
	recursive: boolean;
	scope: InfisicalLinkScope;
	scopeId: string;
	secretPath: string;
	siteUrl: string | null;
}

/** SQLite persistence for the per-machine half of every Infisical link. */
export interface InfisicalLinkStore {
	clear: (input: { scope: InfisicalLinkScope; scopeId: string }) => void;
	/** Resolves a repository's absolute path, used to reach its committed config. */
	readRepositoryPath: (repositoryId: string) => string | null;
	recordSync: (input: {
		scope: InfisicalLinkScope;
		scopeId: string;
		syncedAt: string;
	}) => void;
	rows: (input: {
		scope: InfisicalLinkScope;
		scopeId: string;
	}) => InfisicalLinkRow | null;
	write: (input: WriteInfisicalLinkInput) => InfisicalLinkRow | null;
}

/** Options for {@link createInfisicalLinkStore}. */
export interface CreateInfisicalLinkStoreOptions {
	database: DatabaseSync;
	now?: () => Date;
}

/**
 * Builds the link store. It owns only what is per-machine — the account choice,
 * the enabled flag, and the last sync time — because the project half is
 * committed to the repository instead.
 * @param options - Database handle and injectable clock.
 * @returns A fresh {@link InfisicalLinkStore}.
 */
export function createInfisicalLinkStore({
	database,
	now = () => new Date(),
}: CreateInfisicalLinkStoreOptions): InfisicalLinkStore {
	return {
		clear: ({ scope, scopeId }) => {
			database
				.prepare('DELETE FROM infisical_links WHERE scope = ? AND scope_id = ?')
				.run(scope, scopeId);
		},

		readRepositoryPath: (repositoryId) => {
			const row = database
				.prepare('SELECT path FROM repositories WHERE id = ?')
				.get(repositoryId);

			return readStringColumn(row, 'path');
		},

		recordSync: ({ scope, scopeId, syncedAt }) => {
			database
				.prepare(
					`UPDATE infisical_links
					 SET last_synced_at = ?, updated_at = ?
					 WHERE scope = ? AND scope_id = ?`,
				)
				.run(syncedAt, now().toISOString(), scope, scopeId);
		},

		rows: ({ scope, scopeId }) => {
			const row = database
				.prepare(
					'SELECT * FROM infisical_links WHERE scope = ? AND scope_id = ?',
				)
				.get(scope, scopeId);

			return row ? toLinkRow(row) : null;
		},

		write: (input) => {
			const timestamp = now().toISOString();

			database
				.prepare(
					`INSERT INTO infisical_links
						(scope, scope_id, account_id, site_url, project_id, project_name,
						 environment_slug, folder_path, recursive, enabled, last_synced_at,
						 created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
					 ON CONFLICT(scope, scope_id) DO UPDATE SET
						account_id = excluded.account_id,
						site_url = excluded.site_url,
						project_id = excluded.project_id,
						project_name = excluded.project_name,
						environment_slug = excluded.environment_slug,
						folder_path = excluded.folder_path,
						recursive = excluded.recursive,
						enabled = excluded.enabled,
						updated_at = excluded.updated_at`,
				)
				.run(
					input.scope,
					input.scopeId,
					input.accountId,
					input.siteUrl,
					input.projectId,
					input.projectName,
					input.environmentSlug,
					input.secretPath || '/',
					input.recursive ? 1 : 0,
					input.enabled ? 1 : 0,
					timestamp,
					timestamp,
				);

			const row = database
				.prepare(
					'SELECT * FROM infisical_links WHERE scope = ? AND scope_id = ?',
				)
				.get(input.scope, input.scopeId);

			return row ? toLinkRow(row) : null;
		},
	};
}

/**
 * Maps a raw SQLite row onto a link row, rejecting rows missing the columns
 * every caller depends on.
 * @param row - Raw row value.
 * @returns The link row, or null when the row is unusable.
 */
function toLinkRow(row: unknown): InfisicalLinkRow | null {
	if (typeof row !== 'object' || row === null) {
		return null;
	}

	const source = row as Record<string, unknown>;
	const scope = source.scope;
	const scopeId = readStringColumn(row, 'scope_id');
	const projectId = readStringColumn(row, 'project_id');

	if ((scope !== 'repository' && scope !== 'workspace') || !scopeId) {
		return null;
	}

	return {
		accountId: readStringColumn(row, 'account_id'),
		enabled: source.enabled !== 0,
		environmentSlug: readStringColumn(row, 'environment_slug') ?? '',
		lastSyncedAt: readStringColumn(row, 'last_synced_at'),
		projectId: projectId ?? '',
		projectName: readStringColumn(row, 'project_name'),
		recursive: source.recursive === 1,
		scope,
		scopeId,
		secretPath: readStringColumn(row, 'folder_path') ?? '/',
		siteUrl: readStringColumn(row, 'site_url'),
	};
}

/**
 * Reads a non-empty string column off a raw SQLite row.
 * @param row - Raw row value.
 * @param column - Column to read.
 * @returns The value, or null when absent, non-string, or empty.
 */
function readStringColumn(row: unknown, column: string): string | null {
	if (typeof row !== 'object' || row === null) {
		return null;
	}

	const value = (row as Record<string, unknown>)[column];

	return typeof value === 'string' && value ? value : null;
}
