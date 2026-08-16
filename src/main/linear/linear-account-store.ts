import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
	LinearAccountSnapshot,
	LinearAuthFailureCode,
	LinearConnectionState,
} from '../../shared/ipc/contracts/linear';
import type { SecretStore } from '../secrets';

/**
 * Secret-store key prefixes for per-account tokens. The suffix is the account
 * id, so each account owns its own pair of Keychain entries at `app` scope.
 */
const ACCESS_TOKEN_KEY_PREFIX = 'linear-access-token:';
const REFRESH_TOKEN_KEY_PREFIX = 'linear-refresh-token:';

/** Persisted, non-secret half of one connected Linear account. */
export interface LinearAccountRecord {
	canRefresh: boolean;
	createdAt: string;
	expiresAt: string | null;
	id: string;
	lastErrorCode: LinearAuthFailureCode | null;
	organizationId: string;
	organizationName: string | null;
	organizationUrlKey: string | null;
	scopes: string[];
	updatedAt: string;
	userEmail: string | null;
	userId: string;
	userName: string | null;
}

/** Identity and grant details a completed login supplies for an account row. */
export interface LinearAccountIdentity {
	canRefresh: boolean;
	expiresAt: string | null;
	organizationId: string;
	organizationName: string | null;
	organizationUrlKey: string | null;
	scopes: string[];
	userEmail: string | null;
	userId: string;
	userName: string | null;
}

/** Token pair written to the Keychain for one account. */
export interface LinearAccountTokens {
	accessToken: string;
	refreshToken: string | null;
}

/** Account persistence: SQLite for the record, Keychain for the tokens. */
export interface LinearAccountStore {
	delete: (accountId: string) => Promise<void>;
	get: (accountId: string) => LinearAccountRecord | null;
	list: () => LinearAccountRecord[];
	readAccessToken: (accountId: string) => Promise<string | null>;
	readRefreshToken: (accountId: string) => Promise<string | null>;
	/**
	 * Removes the stored refresh token, for a grant that replaced one which could
	 * be renewed with one that cannot. `writeTokens` deliberately leaves the entry
	 * alone on a null refresh token, because an ordinary refresh that does not
	 * rotate reports null and must not destroy the token it just used.
	 */
	clearRefreshToken: (accountId: string) => Promise<void>;
	recordError: (
		accountId: string,
		errorCode: LinearAuthFailureCode | null,
	) => void;
	/** Records a refreshed grant without disturbing the stored identity. */
	recordGrant: (
		accountId: string,
		grant: { canRefresh: boolean; expiresAt: string | null; scopes: string[] },
	) => void;
	/**
	 * Inserts or refreshes the account for one Linear identity, keyed by
	 * organization and user so reconnecting the same identity updates its row
	 * rather than adding a second one.
	 */
	upsertIdentity: (identity: LinearAccountIdentity) => LinearAccountRecord;
	writeTokens: (
		accountId: string,
		tokens: LinearAccountTokens,
	) => Promise<void>;
}

/** Options for {@link createLinearAccountStore}. */
export interface CreateLinearAccountStoreOptions {
	database: DatabaseSync;
	idFactory?: () => string;
	now?: () => Date;
	secretStore: SecretStore | null;
}

/**
 * Builds the Linear account store. Tokens never land in SQLite — only in the
 * Keychain entry named after the account id — so a database copied off the
 * machine carries no credential.
 * @param options - Database, secret store, and injectable id/clock.
 * @returns A fresh {@link LinearAccountStore}.
 */
export function createLinearAccountStore({
	database,
	idFactory = randomUUID,
	now = () => new Date(),
	secretStore,
}: CreateLinearAccountStoreOptions): LinearAccountStore {
	/**
	 * Reads one secret, treating an unavailable backend as an absent value so a
	 * disconnect or a status read never fails on the Keychain.
	 * @param key - Secret key to read.
	 * @returns The stored value, or null when it is missing or unreadable.
	 */
	async function readSecret(key: string): Promise<string | null> {
		if (!secretStore) {
			return null;
		}

		try {
			return await secretStore.read({ key, scope: 'app' });
		} catch {
			return null;
		}
	}

	/**
	 * Creates or replaces one secret.
	 * @param key - Secret key to persist.
	 * @param displayName - Human-readable label shown in Keychain.
	 * @param value - Secret value to store.
	 */
	async function writeSecret(
		key: string,
		displayName: string,
		value: string,
	): Promise<void> {
		if (!secretStore) {
			throw new Error('No secret store backend is available.');
		}

		const input = { displayName, key, scope: 'app' as const, value };
		const existing = await secretStore.read({ key, scope: 'app' });

		if (existing === null) {
			await secretStore.create(input);
		} else {
			await secretStore.update(input);
		}
	}

	/**
	 * Best-effort deletion of one secret; a credential that is already gone must
	 * not make an account impossible to remove.
	 * @param key - Secret key to delete.
	 */
	async function deleteSecret(key: string): Promise<void> {
		if (!secretStore) {
			return;
		}

		try {
			await secretStore.delete({ key, scope: 'app' });
		} catch {
			// Missing entries and Keychain errors must not block disconnect.
		}
	}

	return {
		clearRefreshToken: (accountId) =>
			deleteSecret(`${REFRESH_TOKEN_KEY_PREFIX}${accountId}`),

		delete: async (accountId) => {
			await deleteSecret(`${ACCESS_TOKEN_KEY_PREFIX}${accountId}`);
			await deleteSecret(`${REFRESH_TOKEN_KEY_PREFIX}${accountId}`);
			database
				.prepare('DELETE FROM linear_accounts WHERE id = ?')
				.run(accountId);
		},

		get: (accountId) => readAccountRow(database, accountId),

		list: () => {
			const rows = database
				.prepare(
					'SELECT * FROM linear_accounts ORDER BY created_at, organization_name',
				)
				.all();

			return rows.map(toAccountRecord).filter((row) => row !== null);
		},

		readAccessToken: (accountId) =>
			readSecret(`${ACCESS_TOKEN_KEY_PREFIX}${accountId}`),

		readRefreshToken: (accountId) =>
			readSecret(`${REFRESH_TOKEN_KEY_PREFIX}${accountId}`),

		recordError: (accountId, errorCode) => {
			database
				.prepare(
					'UPDATE linear_accounts SET last_error_code = ?, updated_at = ? WHERE id = ?',
				)
				.run(errorCode, now().toISOString(), accountId);
		},

		recordGrant: (accountId, { canRefresh, expiresAt, scopes }) => {
			database
				.prepare(
					`UPDATE linear_accounts
					 SET expires_at = ?, can_refresh = ?, scopes_json = ?,
						last_error_code = NULL, updated_at = ?
					 WHERE id = ?`,
				)
				.run(
					expiresAt,
					canRefresh ? 1 : 0,
					JSON.stringify(scopes),
					now().toISOString(),
					accountId,
				);
		},

		upsertIdentity: (identity) => {
			const timestamp = now().toISOString();
			const existing = database
				.prepare(
					'SELECT id FROM linear_accounts WHERE organization_id = ? AND user_id = ?',
				)
				.get(identity.organizationId, identity.userId) as
				| { id: string }
				| undefined;
			const id = existing?.id ?? idFactory();

			database
				.prepare(
					`INSERT INTO linear_accounts
						(id, organization_id, organization_name, organization_url_key,
						 user_id, user_name, user_email, scopes_json, expires_at,
						 can_refresh, last_error_code, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
					 ON CONFLICT(organization_id, user_id) DO UPDATE SET
						organization_name = excluded.organization_name,
						organization_url_key = excluded.organization_url_key,
						user_name = excluded.user_name,
						user_email = excluded.user_email,
						scopes_json = excluded.scopes_json,
						expires_at = excluded.expires_at,
						can_refresh = excluded.can_refresh,
						last_error_code = NULL,
						updated_at = excluded.updated_at`,
				)
				.run(
					id,
					identity.organizationId,
					identity.organizationName,
					identity.organizationUrlKey,
					identity.userId,
					identity.userName,
					identity.userEmail,
					JSON.stringify(identity.scopes),
					identity.expiresAt,
					identity.canRefresh ? 1 : 0,
					timestamp,
					timestamp,
				);

			const saved = readAccountRow(database, id);

			if (!saved) {
				throw new Error(
					'The Linear account could not be read back after it was saved.',
				);
			}

			return saved;
		},

		writeTokens: async (accountId, { accessToken, refreshToken }) => {
			await writeSecret(
				`${ACCESS_TOKEN_KEY_PREFIX}${accountId}`,
				`Linear access token (${accountId})`,
				accessToken,
			);

			if (refreshToken) {
				await writeSecret(
					`${REFRESH_TOKEN_KEY_PREFIX}${accountId}`,
					`Linear refresh token (${accountId})`,
					refreshToken,
				);
			}
		},
	};
}

/**
 * Projects an account record onto the snapshot the renderer and setup check
 * read, resolving its per-account connection state.
 * @param record - Stored account record.
 * @param isExpired - Whether the record's access token has passed its expiry.
 * @returns The account snapshot.
 */
export function toAccountSnapshot(
	record: LinearAccountRecord,
	isExpired: boolean,
): LinearAccountSnapshot {
	return {
		expiresAt: record.expiresAt,
		id: record.id,
		lastErrorCode: record.lastErrorCode,
		organizationId: record.organizationId,
		organizationName: record.organizationName,
		organizationUrlKey: record.organizationUrlKey,
		scopes: record.scopes,
		state: accountState(record, isExpired),
		updatedAt: record.updatedAt,
		userEmail: record.userEmail,
		userId: record.userId,
		userName: record.userName,
	};
}

/**
 * Resolves one account's connection state. An expired token that cannot be
 * refreshed is the only case a user has to act on.
 * @param record - Stored account record.
 * @param isExpired - Whether the record's access token has passed its expiry.
 * @returns The account's connection state.
 */
function accountState(
	record: LinearAccountRecord,
	isExpired: boolean,
): LinearConnectionState {
	return isExpired && !record.canRefresh ? 'reconnect-required' : 'connected';
}

/**
 * Reads and maps a single account row.
 * @param database - Active SQLite handle.
 * @param accountId - Account to read.
 * @returns The record, or null when no such account exists.
 */
function readAccountRow(
	database: DatabaseSync,
	accountId: string,
): LinearAccountRecord | null {
	const row = database
		.prepare('SELECT * FROM linear_accounts WHERE id = ?')
		.get(accountId);

	return row ? toAccountRecord(row) : null;
}

/**
 * Maps a raw SQLite row onto an account record, rejecting rows missing the
 * columns every caller depends on.
 * @param row - Raw row value.
 * @returns The record, or null when the row is unusable.
 */
function toAccountRecord(row: unknown): LinearAccountRecord | null {
	if (typeof row !== 'object' || row === null) {
		return null;
	}

	const source = row as Record<string, unknown>;
	const id = readString(source.id);
	const organizationId = readString(source.organization_id);
	const userId = readString(source.user_id);

	if (!id || !organizationId || !userId) {
		return null;
	}

	return {
		createdAt: readString(source.created_at) ?? '',
		expiresAt: readString(source.expires_at),
		canRefresh: source.can_refresh === 1,
		id,
		lastErrorCode: readString(
			source.last_error_code,
		) as LinearAuthFailureCode | null,
		organizationId,
		organizationName: readString(source.organization_name),
		organizationUrlKey: readString(source.organization_url_key),
		scopes: readScopes(source.scopes_json),
		updatedAt: readString(source.updated_at) ?? '',
		userEmail: readString(source.user_email),
		userId,
		userName: readString(source.user_name),
	};
}

/**
 * Narrows an unknown column value to a string.
 * @param value - Raw column value.
 * @returns The value as a string, or null.
 */
function readString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

/**
 * Decodes the stored scope list, falling back to an empty grant on malformed
 * JSON so one bad row cannot break the account list.
 * @param value - Raw `scopes_json` column value.
 * @returns The decoded scopes.
 */
function readScopes(value: unknown): string[] {
	if (typeof value !== 'string') {
		return [];
	}

	try {
		const parsed = JSON.parse(value) as unknown;

		return Array.isArray(parsed)
			? parsed.filter((scope): scope is string => typeof scope === 'string')
			: [];
	} catch {
		return [];
	}
}
