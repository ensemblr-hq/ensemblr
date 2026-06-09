import type { DatabaseSync } from 'node:sqlite';

import { formatLookup } from './normalize.ts';
import {
	type KeychainReference,
	type NormalizedLookup,
	type NormalizedWriteInput,
	type SecretBackend,
	type SecretMetadata,
	type SecretMetadataFilter,
	type SecretScope,
	SECRET_SCOPES,
	SecretStoreError,
} from './secret-store-types.ts';

/** Internal: raw row shape stored in the `secret_metadata` table. */
interface SecretMetadataRow {
	account: string;
	backend: SecretBackend;
	character_count: number;
	created_at: string;
	display_name: string;
	id: string;
	masked_display: string;
	metadata_json: string;
	name: string;
	scope: SecretScope;
	scope_id: string;
	service: string;
	updated_at: string;
}

/** Payload used to persist a metadata row from a Keychain-backed entry. */
export type MetadataPersistInput = NormalizedWriteInput &
	KeychainReference & {
		backend: 'macos-keychain';
		id: string;
		maskedDisplay: string;
		now: string;
	};

/**
 * Storage-agnostic metadata DAO. The Keychain backend composes this interface
 * to persist non-sensitive metadata alongside the encrypted Keychain payload.
 */
export interface MetadataStore {
	delete: (lookup: NormalizedLookup) => void;
	get: (lookup: NormalizedLookup) => SecretMetadata | null;
	insert: (input: MetadataPersistInput) => SecretMetadata;
	list: (filter?: SecretMetadataFilter) => SecretMetadata[];
	update: (input: MetadataPersistInput) => SecretMetadata;
}

/**
 * Builds the SQLite-backed metadata store used by the Keychain backend.
 * @param database - Open SQLite connection.
 * @returns A {@link MetadataStore} over the `secret_metadata` table.
 */
export function createSqliteSecretMetadataStore(
	database: DatabaseSync,
): MetadataStore {
	const store: MetadataStore = {
		/** Deletes the metadata row matching the lookup. */
		delete(lookup) {
			database
				.prepare(
					`DELETE FROM secret_metadata
					 WHERE scope = ? AND scope_id = ? AND name = ?`,
				)
				.run(lookup.scope, lookup.scopeId, lookup.key);
		},
		/** Loads the metadata row matching the lookup, or `null`. */
		get(lookup) {
			const row = database
				.prepare(
					`SELECT *
					 FROM secret_metadata
					 WHERE scope = ? AND scope_id = ? AND name = ?`,
				)
				.get(lookup.scope, lookup.scopeId, lookup.key);

			return row ? parseMetadataRow(row) : null;
		},
		/** Inserts a new metadata row, returning the persisted shape. */
		insert(input) {
			database
				.prepare(
					`INSERT INTO secret_metadata (
						id,
						scope,
						scope_id,
						name,
						backend,
						service,
						account,
						display_name,
						masked_display,
						character_count,
						metadata_json,
						created_at,
						updated_at
					)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					input.id,
					input.scope,
					input.scopeId,
					input.key,
					input.backend,
					input.service,
					input.account,
					input.displayName,
					input.maskedDisplay,
					input.value.length,
					JSON.stringify(input.metadata),
					input.now,
					input.now,
				);

			const inserted = store.get(input);

			if (!inserted) {
				throw new SecretStoreError(
					'metadata-error',
					`Failed to create secret metadata for ${formatLookup(input)}.`,
				);
			}

			return inserted;
		},
		/** Lists every matching metadata row, ordered by `(scope, scope_id, name)`. */
		list(filter = {}) {
			if (filter.scope && filter.scopeId !== undefined) {
				const rows = database
					.prepare(
						`SELECT *
						 FROM secret_metadata
						 WHERE scope = ? AND scope_id = ?
						 ORDER BY scope, scope_id, name`,
					)
					.all(filter.scope, filter.scopeId);

				return rows.map(parseMetadataRow);
			}

			if (filter.scope) {
				const rows = database
					.prepare(
						`SELECT *
						 FROM secret_metadata
						 WHERE scope = ?
						 ORDER BY scope, scope_id, name`,
					)
					.all(filter.scope);

				return rows.map(parseMetadataRow);
			}

			const rows = database
				.prepare(
					`SELECT *
					 FROM secret_metadata
					 ORDER BY scope, scope_id, name`,
				)
				.all();

			return rows.map(parseMetadataRow);
		},
		/** Updates an existing metadata row, returning the persisted shape. */
		update(input) {
			database
				.prepare(
					`UPDATE secret_metadata
					 SET
						backend = ?,
						service = ?,
						account = ?,
						display_name = ?,
						masked_display = ?,
						character_count = ?,
						metadata_json = ?,
						updated_at = ?
					 WHERE scope = ? AND scope_id = ? AND name = ?`,
				)
				.run(
					input.backend,
					input.service,
					input.account,
					input.displayName,
					input.maskedDisplay,
					input.value.length,
					JSON.stringify(input.metadata),
					input.now,
					input.scope,
					input.scopeId,
					input.key,
				);

			const updated = store.get(input);

			if (!updated) {
				throw new SecretStoreError(
					'metadata-error',
					`Failed to update secret metadata for ${formatLookup(input)}.`,
				);
			}

			return updated;
		},
	};

	return store;
}

/**
 * Maps a raw SQLite row to the {@link SecretMetadata} shape, validating the row.
 * @param row - Raw row value.
 * @returns The structured metadata.
 */
function parseMetadataRow(row: unknown): SecretMetadata {
	if (!isSecretMetadataRow(row)) {
		throw new SecretStoreError(
			'metadata-error',
			'Secret metadata row had an unexpected shape.',
		);
	}

	return {
		account: row.account,
		backend: row.backend,
		characterCount: row.character_count,
		createdAt: row.created_at,
		displayName: row.display_name,
		id: row.id,
		key: row.name,
		maskedDisplay: row.masked_display,
		metadata: parseMetadataJson(row.metadata_json),
		scope: row.scope,
		scopeId: row.scope_id,
		service: row.service,
		updatedAt: row.updated_at,
	};
}

/**
 * Type guard for the `secret_metadata` table row shape.
 * @param row - Candidate row value.
 * @returns True when every expected column is present and well-typed.
 */
function isSecretMetadataRow(row: unknown): row is SecretMetadataRow {
	if (typeof row !== 'object' || row === null) {
		return false;
	}

	const candidate = row as Partial<SecretMetadataRow>;

	return (
		typeof candidate.account === 'string' &&
		(candidate.backend === 'macos-keychain' || candidate.backend === 'mock') &&
		typeof candidate.character_count === 'number' &&
		typeof candidate.created_at === 'string' &&
		typeof candidate.display_name === 'string' &&
		typeof candidate.id === 'string' &&
		typeof candidate.masked_display === 'string' &&
		typeof candidate.metadata_json === 'string' &&
		typeof candidate.name === 'string' &&
		SECRET_SCOPES.includes(candidate.scope as SecretScope) &&
		typeof candidate.scope_id === 'string' &&
		typeof candidate.service === 'string' &&
		typeof candidate.updated_at === 'string'
	);
}

/**
 * Parses the `metadata_json` column, requiring it to be a JSON object.
 * @param value - Raw `metadata_json` string.
 * @returns The parsed record.
 */
function parseMetadataJson(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value);

		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			!Array.isArray(parsed)
		) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		throw new SecretStoreError(
			'metadata-error',
			'Secret metadata JSON could not be parsed.',
		);
	}

	throw new SecretStoreError(
		'metadata-error',
		'Secret metadata JSON must be an object.',
	);
}
