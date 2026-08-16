import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { InfisicalFailureCode } from '../../shared/ipc/contracts/infisical';
import { maskSecret } from '../secrets/normalize.ts';
import type { SecretStore } from '../secrets/secret-store';
import { InfisicalApiError, normalizeSiteUrl } from './infisical-api.ts';

/**
 * Secret-store key prefix for account client secrets. The suffix is the account
 * id, so each account owns one Keychain entry at `app` scope.
 */
const CLIENT_SECRET_KEY_PREFIX = 'infisical-client-secret:';

/** Persisted, non-secret half of one configured Infisical account. */
export interface InfisicalAccountRecord {
	clientId: string;
	createdAt: string;
	id: string;
	label: string;
	lastErrorCode: InfisicalFailureCode | null;
	lastVerifiedAt: string | null;
	siteUrl: string;
	updatedAt: string;
}

/** Fields accepted when adding an account. */
export interface CreateInfisicalAccountInput {
	clientId: string;
	clientSecret: string;
	label: string;
	siteUrl: string;
}

/** Account persistence: SQLite for the record, Keychain for the client secret. */
export interface InfisicalAccountStore {
	create: (
		input: CreateInfisicalAccountInput,
	) => Promise<InfisicalAccountRecord>;
	delete: (accountId: string) => Promise<void>;
	get: (accountId: string) => InfisicalAccountRecord | null;
	list: () => InfisicalAccountRecord[];
	/** Resolves the client secret from the Keychain for a login attempt. */
	readClientSecret: (accountId: string) => Promise<string>;
	readMaskedClientSecret: (accountId: string) => Promise<string | null>;
	recordVerification: (input: {
		accountId: string;
		errorCode: InfisicalFailureCode | null;
	}) => void;
}

/** Options for {@link createInfisicalAccountStore}. */
export interface CreateInfisicalAccountStoreOptions {
	database: DatabaseSync;
	idFactory?: () => string;
	now?: () => Date;
	secretStore: SecretStore | null;
}

/**
 * Builds the account store. The client secret never lands in SQLite — only its
 * Keychain entry — so a database copied off the machine carries no credential.
 * @param options - Database, secret store, and injectable id/clock.
 * @returns A fresh {@link InfisicalAccountStore}.
 */
export function createInfisicalAccountStore({
	database,
	idFactory = randomUUID,
	now = () => new Date(),
	secretStore,
}: CreateInfisicalAccountStoreOptions): InfisicalAccountStore {
	/**
	 * Returns the secret store, or throws when no backend is available so the
	 * caller reports a typed failure instead of silently losing a credential.
	 * @returns The active secret store.
	 */
	function requireSecretStore(): SecretStore {
		if (!secretStore) {
			throw new InfisicalApiError(
				'infisical-secret-store-unavailable',
				'No secret store is available to hold the Infisical client secret.',
			);
		}

		return secretStore;
	}

	/**
	 * Composes the Keychain key holding one account's client secret.
	 * @param accountId - Account the secret belongs to.
	 * @returns The secret-store key.
	 */
	function clientSecretKey(accountId: string): string {
		return `${CLIENT_SECRET_KEY_PREFIX}${accountId}`;
	}

	return {
		create: async ({ clientId, clientSecret, label, siteUrl }) => {
			const trimmedClientId = clientId.trim();
			const trimmedLabel = label.trim();
			const trimmedSecret = clientSecret.trim();

			if (!trimmedClientId || !trimmedSecret) {
				throw new InfisicalApiError(
					'infisical-invalid-request',
					'An Infisical account needs both a Client ID and a Client Secret.',
				);
			}

			const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
			const duplicate = database
				.prepare(
					'SELECT id FROM infisical_accounts WHERE site_url = ? AND client_id = ?',
				)
				.get(normalizedSiteUrl, trimmedClientId);

			if (duplicate) {
				throw new InfisicalApiError(
					'infisical-account-exists',
					'That Client ID is already configured for this Infisical instance.',
				);
			}

			const id = idFactory();
			const timestamp = now().toISOString();

			await requireSecretStore().create({
				displayName: `Infisical client secret (${trimmedLabel || trimmedClientId})`,
				key: clientSecretKey(id),
				metadata: { accountId: id, kind: 'infisical-client-secret' },
				scope: 'app',
				value: trimmedSecret,
			});

			database
				.prepare(
					`INSERT INTO infisical_accounts
						(id, label, site_url, client_id, last_verified_at, last_error_code, created_at, updated_at)
					 VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
				)
				.run(
					id,
					trimmedLabel || trimmedClientId,
					normalizedSiteUrl,
					trimmedClientId,
					timestamp,
					timestamp,
				);

			const created = readAccountRow(database, id);

			if (!created) {
				throw new InfisicalApiError(
					'database-unavailable',
					'The Infisical account could not be read back after it was saved.',
				);
			}

			return created;
		},

		delete: async (accountId) => {
			if (secretStore) {
				try {
					await secretStore.delete({
						key: clientSecretKey(accountId),
						scope: 'app',
					});
				} catch {
					// A credential that is already gone must not block removing the
					// account row, or the account becomes impossible to delete.
				}
			}

			database
				.prepare('DELETE FROM infisical_accounts WHERE id = ?')
				.run(accountId);
		},

		get: (accountId) => readAccountRow(database, accountId),

		list: () => {
			const rows = database
				.prepare('SELECT * FROM infisical_accounts ORDER BY created_at, label')
				.all();

			return rows.map(toAccountRecord).filter((row) => row !== null);
		},

		readClientSecret: async (accountId) => {
			const value = await requireSecretStore().read({
				key: clientSecretKey(accountId),
				scope: 'app',
			});

			if (!value) {
				throw new InfisicalApiError(
					'infisical-secret-store-unavailable',
					'The client secret for this Infisical account is missing from the Keychain.',
				);
			}

			return value;
		},

		readMaskedClientSecret: async (accountId) => {
			if (!secretStore) {
				return null;
			}

			try {
				const value = await secretStore.read({
					key: clientSecretKey(accountId),
					scope: 'app',
				});

				return value ? maskSecret(value) : null;
			} catch {
				return null;
			}
		},

		recordVerification: ({ accountId, errorCode }) => {
			database
				.prepare(
					`UPDATE infisical_accounts
					 SET last_verified_at = ?, last_error_code = ?, updated_at = ?
					 WHERE id = ?`,
				)
				.run(
					errorCode ? null : now().toISOString(),
					errorCode,
					now().toISOString(),
					accountId,
				);
		},
	};
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
): InfisicalAccountRecord | null {
	const row = database
		.prepare('SELECT * FROM infisical_accounts WHERE id = ?')
		.get(accountId);

	return row ? toAccountRecord(row) : null;
}

/**
 * Maps a raw SQLite row onto an account record, rejecting rows missing the
 * columns every caller depends on.
 * @param row - Raw row value.
 * @returns The record, or null when the row is unusable.
 */
function toAccountRecord(row: unknown): InfisicalAccountRecord | null {
	if (typeof row !== 'object' || row === null) {
		return null;
	}

	const source = row as Record<string, unknown>;
	const id = typeof source.id === 'string' ? source.id : null;
	const clientId =
		typeof source.client_id === 'string' ? source.client_id : null;
	const siteUrl = typeof source.site_url === 'string' ? source.site_url : null;

	if (!id || !clientId || !siteUrl) {
		return null;
	}

	return {
		clientId,
		createdAt: typeof source.created_at === 'string' ? source.created_at : '',
		id,
		label: typeof source.label === 'string' ? source.label : clientId,
		lastErrorCode:
			typeof source.last_error_code === 'string'
				? (source.last_error_code as InfisicalFailureCode)
				: null,
		lastVerifiedAt:
			typeof source.last_verified_at === 'string'
				? source.last_verified_at
				: null,
		siteUrl,
		updatedAt: typeof source.updated_at === 'string' ? source.updated_at : '',
	};
}
