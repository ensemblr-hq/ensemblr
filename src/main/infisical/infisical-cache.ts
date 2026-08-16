import type { InfisicalLinkScope } from '../../shared/ipc/contracts/infisical';
import type { SecretStore } from '../secrets/secret-store';

/**
 * Secret-store key holding one scope's cached Infisical values. It carries no
 * `kind: 'environment-variable'` metadata, so the environment collectors ignore
 * it and it never shows up as a variable of its own.
 */
const CACHE_SECRET_KEY = 'infisical-cache';

/** One scope's last successful fetch. */
export interface InfisicalCacheEntry {
	fetchedAt: string;
	values: Record<string, string>;
}

/**
 * Keychain-backed record of the last values Infisical returned for a scope.
 *
 * This is a **failure fallback, not a latency cache**: every resolution fetches
 * live, and the stored entry is read only when that fetch fails. Secrets rotate
 * without warning, so serving a stored value while Infisical is reachable would
 * hand a script a credential that has already been revoked.
 */
export interface InfisicalCache {
	clear: (input: {
		scope: InfisicalLinkScope;
		scopeId: string;
	}) => Promise<void>;
	read: (input: {
		scope: InfisicalLinkScope;
		scopeId: string;
	}) => Promise<InfisicalCacheEntry | null>;
	write: (input: {
		scope: InfisicalLinkScope;
		scopeId: string;
		values: Record<string, string>;
	}) => Promise<InfisicalCacheEntry>;
}

/** Options for {@link createInfisicalCache}. */
export interface CreateInfisicalCacheOptions {
	now?: () => Date;
	secretStore: SecretStore | null;
}

/**
 * Builds the fallback store. Every operation degrades to a miss rather than
 * throwing — a cache failure must never be the reason a workspace cannot open.
 * @param options - Secret store and injectable clock.
 * @returns A fresh {@link InfisicalCache}.
 */
export function createInfisicalCache({
	now = () => new Date(),
	secretStore,
}: CreateInfisicalCacheOptions): InfisicalCache {
	return {
		clear: async ({ scope, scopeId }) => {
			if (!secretStore) {
				return;
			}

			try {
				await secretStore.delete({ key: CACHE_SECRET_KEY, scope, scopeId });
			} catch {
				// An absent entry is the state the caller wanted anyway.
			}
		},

		read: async ({ scope, scopeId }) => {
			if (!secretStore) {
				return null;
			}

			try {
				const raw = await secretStore.read({
					key: CACHE_SECRET_KEY,
					scope,
					scopeId,
				});

				return raw ? parseCacheEntry(raw) : null;
			} catch {
				return null;
			}
		},

		write: async ({ scope, scopeId, values }) => {
			const entry: InfisicalCacheEntry = {
				fetchedAt: now().toISOString(),
				values,
			};

			if (!secretStore) {
				return entry;
			}

			const payload = JSON.stringify(entry);

			try {
				await secretStore.update({
					displayName: 'Infisical cached values',
					key: CACHE_SECRET_KEY,
					metadata: { kind: 'infisical-cache' },
					scope,
					scopeId,
					value: payload,
				});
			} catch {
				try {
					await secretStore.create({
						displayName: 'Infisical cached values',
						key: CACHE_SECRET_KEY,
						metadata: { kind: 'infisical-cache' },
						scope,
						scopeId,
						value: payload,
					});
				} catch {
					// Losing the cache costs freshness on the next cold start, not
					// correctness; the live fetch already produced these values.
				}
			}

			return entry;
		},
	};
}

/**
 * Parses a stored cache payload, rejecting anything that is not a string map so
 * a corrupted entry reads as a miss.
 * @param raw - Raw stored JSON.
 * @returns The entry, or null when it cannot be trusted.
 */
function parseCacheEntry(raw: string): InfisicalCacheEntry | null {
	let parsed: unknown;

	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		!('values' in parsed) ||
		typeof parsed.values !== 'object' ||
		parsed.values === null
	) {
		return null;
	}

	const values: Record<string, string> = {};

	for (const [key, value] of Object.entries(parsed.values)) {
		if (typeof value === 'string') {
			values[key] = value;
		}
	}

	return {
		fetchedAt:
			'fetchedAt' in parsed && typeof parsed.fetchedAt === 'string'
				? parsed.fetchedAt
				: '',
		values,
	};
}
