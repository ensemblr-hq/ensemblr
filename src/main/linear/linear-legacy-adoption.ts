/**
 * Adoption of the pre-ADR-0052 single Linear connection.
 *
 * Before ADR 0052 there was exactly one connection: two fixed Keychain entries
 * and one `integration_metadata` row keyed `resource_id = 'default'`. On the
 * first read after the upgrade that grant is moved onto the per-account keys and
 * the legacy row is deleted, so a user connected before the upgrade stays
 * connected without noticing.
 *
 * Split out of `linear-auth-service.ts` because it is a one-way migration with a
 * finite life: it runs at most once per launch, only while no account exists,
 * and every symbol here becomes dead the release after the last pre-0052
 * install is gone. Keeping it in its own module makes that deletion a file
 * removal rather than an archaeology exercise.
 */

import type { DatabaseSync } from 'node:sqlite';

import type { SecretStore } from '../secrets';
import type {
	LinearAccountIdentity,
	LinearAccountStore,
} from './linear-account-store.ts';

const LEGACY_ACCESS_TOKEN_KEY = 'linear-access-token';
const LEGACY_REFRESH_TOKEN_KEY = 'linear-refresh-token';
const LEGACY_RESOURCE_TYPE = 'connection';
const LEGACY_RESOURCE_ID = 'default';

/**
 * Sentinel ids an account adopted offline is stored under. Adoption needs the
 * network to learn the organization and viewer ids that key the row; when it
 * cannot, the account is kept under these so the user stays connected, and the
 * next successful login for the same organization replaces it.
 */
export const UNRESOLVED_ORGANIZATION_ID = 'legacy:organization';
export const UNRESOLVED_USER_ID = 'legacy:user';

/** The pre-ADR-0052 connection row's non-secret payload, as adoption reads it. */
interface LegacyConnectionMetadata {
	expiresAt: string | null;
	organizationName: string | null;
	organizationUrlKey: string | null;
	scopes: string[];
	userEmail: string | null;
	userName: string | null;
}

/** Viewer and organization identity read back from Linear after a login. */
export interface ViewerIdentity {
	organizationId: string | null;
	organizationName: string | null;
	organizationUrlKey: string | null;
	userEmail: string | null;
	userId: string | null;
	userName: string | null;
}

/** Collaborators adoption needs from the auth service. */
export interface LegacyAdoptionDeps {
	/** Opens the database, throwing when it is not available. */
	getDatabase: () => DatabaseSync;
	/** Resolves the identity behind a token, all-null when Linear is unreachable. */
	fetchViewer: (accessToken: string) => Promise<ViewerIdentity>;
	/** Builds the secret backend, or null when there is none. */
	secretStoreFactory: (database: DatabaseSync) => SecretStore | null;
}

/**
 * Build an all-null viewer/organization record used as a fallback.
 * @returns A viewer record with every field set to null
 */
export function nullViewer(): ViewerIdentity {
	return {
		organizationId: null,
		organizationName: null,
		organizationUrlKey: null,
		userEmail: null,
		userId: null,
		userName: null,
	};
}

/**
 * Narrow an unknown value decoded from legacy JSON to a string.
 * @param value - Value decoded from the legacy metadata row
 * @returns The value as a string, or null
 */
export function readNullableString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

/**
 * Pick the first value that is actually a string, so a field can fall back from
 * what Linear reported to what the legacy row held without a chain of nullish
 * coalescing per field.
 * @param values - Candidates in preference order
 * @returns The first string, or null when none is set
 */
function firstKnown(
	...values: Array<string | null | undefined>
): string | null {
	return values.find((value) => typeof value === 'string') ?? null;
}

/**
 * Merge what Linear reported with what the legacy row already held, preferring
 * Linear and falling back to the row. When Linear could not be reached at all the
 * ids fall through to sentinels, which keeps the user connected and marks the row
 * for the next login to replace.
 * @param legacy - Metadata from the pre-ADR-0052 connection row, if any
 * @param viewer - Identity Linear reported, all-null when it could not be reached
 * @param canRefresh - Whether a refresh token came across with the grant
 * @returns The identity to upsert the adopted account under
 */
function legacyIdentity(
	legacy: LegacyConnectionMetadata | null,
	viewer: ViewerIdentity,
	canRefresh: boolean,
): LinearAccountIdentity {
	return {
		canRefresh,
		expiresAt: legacy?.expiresAt ?? null,
		organizationId:
			firstKnown(viewer.organizationId) ?? UNRESOLVED_ORGANIZATION_ID,
		organizationName: firstKnown(
			viewer.organizationName,
			legacy?.organizationName,
		),
		organizationUrlKey: firstKnown(
			viewer.organizationUrlKey,
			legacy?.organizationUrlKey,
		),
		scopes: legacy?.scopes ?? [],
		userEmail: firstKnown(viewer.userEmail, legacy?.userEmail),
		userId: firstKnown(viewer.userId) ?? UNRESOLVED_USER_ID,
		userName: firstKnown(viewer.userName, legacy?.userName),
	};
}

/**
 * Read one legacy Keychain entry, separating "the backend answered, and there is
 * nothing there" from "the backend could not be reached". Adoption may only
 * destroy the legacy row on the first; a locked Keychain that reads as an absent
 * connection deletes the identity while its tokens stay behind.
 * @param secretStore - Secret backend holding the legacy entries
 * @param key - Legacy entry to read
 * @returns Whether the backend answered, and the value it held
 */
async function readLegacySecret(
	secretStore: SecretStore,
	key: string,
): Promise<{ readable: boolean; value: string | null }> {
	try {
		return {
			readable: true,
			value: await secretStore.read({ key, scope: 'app' }),
		};
	} catch {
		return { readable: false, value: null };
	}
}

/**
 * Best-effort removal of the pre-ADR-0052 unsuffixed token entries, once their
 * values have been rewritten under the adopted account's own keys.
 * @param secretStore - Secret backend holding the legacy entries
 */
async function forgetLegacySecrets(secretStore: SecretStore): Promise<void> {
	await Promise.all(
		[LEGACY_ACCESS_TOKEN_KEY, LEGACY_REFRESH_TOKEN_KEY].map((key) =>
			secretStore.delete({ key, scope: 'app' }).catch(() => undefined),
		),
	);
}

/**
 * Read the pre-ADR-0052 connection metadata row.
 * @param database - Open Ensemblr database
 * @returns The parsed legacy metadata, or null when absent or malformed
 */
function readLegacyMetadata(
	database: DatabaseSync,
): LegacyConnectionMetadata | null {
	const row = database
		.prepare(
			`SELECT metadata_json FROM integration_metadata
			 WHERE provider = 'linear' AND resource_type = ? AND resource_id = ?`,
		)
		.get(LEGACY_RESOURCE_TYPE, LEGACY_RESOURCE_ID) as
		| { metadata_json: string }
		| undefined;

	if (!row) {
		return null;
	}

	try {
		const parsed = JSON.parse(row.metadata_json) as Record<string, unknown>;

		return {
			expiresAt: readNullableString(parsed.expiresAt),
			organizationName: readNullableString(parsed.organizationName),
			organizationUrlKey: readNullableString(parsed.organizationUrlKey),
			scopes: Array.isArray(parsed.scopes)
				? parsed.scopes.filter(
						(scope): scope is string => typeof scope === 'string',
					)
				: [],
			userEmail: readNullableString(parsed.userEmail),
			userName: readNullableString(parsed.userName),
		};
	} catch {
		return null;
	}
}

/**
 * Delete the pre-ADR-0052 connection metadata row.
 * @param database - Open Ensemblr database
 */
function deleteLegacyMetadata(database: DatabaseSync): void {
	database
		.prepare(
			`DELETE FROM integration_metadata
			 WHERE provider = 'linear' AND resource_type = ? AND resource_id = ?`,
		)
		.run(LEGACY_RESOURCE_TYPE, LEGACY_RESOURCE_ID);
}

/**
 * Adopt the pre-ADR-0052 single connection as the first account, moving its
 * tokens to the per-account Keychain keys and clearing the legacy row. Only acts
 * while no account exists, so a store that already holds one is left alone.
 * @param deps - Database, viewer lookup, and secret backend
 * @param store - Account store to adopt into
 */
export async function adoptLegacyConnection(
	deps: LegacyAdoptionDeps,
	store: LinearAccountStore,
): Promise<void> {
	if (store.list().length > 0) {
		return;
	}

	const database = deps.getDatabase();
	const secretStore = deps.secretStoreFactory(database);

	if (!secretStore) {
		return;
	}

	const legacyToken = await readLegacySecret(
		secretStore,
		LEGACY_ACCESS_TOKEN_KEY,
	);

	if (!legacyToken.readable) {
		return;
	}

	if (!legacyToken.value) {
		deleteLegacyMetadata(database);
		return;
	}

	const accessToken = legacyToken.value;
	const refreshToken = (
		await readLegacySecret(secretStore, LEGACY_REFRESH_TOKEN_KEY)
	).value;
	const account = store.upsertIdentity(
		legacyIdentity(
			readLegacyMetadata(database),
			await deps.fetchViewer(accessToken),
			refreshToken !== null,
		),
	);

	await store.writeTokens(account.id, { accessToken, refreshToken });
	await forgetLegacySecrets(secretStore);
	deleteLegacyMetadata(database);
}
