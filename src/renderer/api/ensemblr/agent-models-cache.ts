import type { AgentModelCatalog } from '@/shared/ipc/contracts/agent-models';

/**
 * localStorage persistence for the Pi model catalog so the picker/settings have
 * the last-known list available instantly on launch while a fresh
 * `pi --list-models` runs in the background (stale-while-revalidate).
 *
 * Only non-empty catalogs are stored: the IPC handler returns an empty result
 * when `pi` is unavailable, and overwriting with that would blank the cache.
 *
 * The key carries a version because the cache outlives a fix to what it holds.
 * A `pi` with no configured provider used to be listed as one model named
 * `No/models`, scraped out of the prose `pi --list-models` prints instead of a
 * table; every read after the parser stopped producing it would still answer
 * with the cached copy, since an empty live listing falls back to the cache by
 * design. Bumping the version retires those snapshots instead.
 */
const CACHE_KEY = 'ensemblr_pref_pi_models_snapshot_v2';

/**
 * Resolves the Storage to use, defaulting to `globalThis.localStorage` when
 * available and returning null in non-browser contexts.
 * @param storage - Explicit storage to use, e.g. in tests
 * @returns The storage instance, or null when none is available
 */
function resolveStorage(storage?: Storage): Storage | null {
	if (storage) {
		return storage;
	}
	return typeof globalThis.localStorage === 'undefined'
		? null
		: globalThis.localStorage;
}

/** Type guard for a stored catalog — never trust the parsed JSON. */
function isAgentModelCatalog(value: unknown): value is AgentModelCatalog {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	if (!Array.isArray(candidate.models)) {
		return false;
	}
	return candidate.models.every(
		(model) =>
			typeof model === 'object' &&
			model !== null &&
			typeof (model as { id?: unknown }).id === 'string',
	);
}

/**
 * Reads the cached catalog. Returns `undefined` on a missing/corrupt entry, an
 * invalid shape, or an empty list (treated as "no usable cache").
 */
export function readCachedAgentModels(
	storage?: Storage,
): AgentModelCatalog | undefined {
	const store = resolveStorage(storage);
	if (!store) {
		return undefined;
	}
	const raw = store.getItem(CACHE_KEY);
	if (!raw) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (isAgentModelCatalog(parsed) && parsed.models.length > 0) {
			return parsed;
		}
	} catch {
		// Corrupt entry — fall through and report no cache.
	}
	return undefined;
}

/**
 * Persists a non-empty reconciled catalog. The query owns transient partial-
 * listing protection, so any result that reaches this boundary is authoritative
 * and may retire providers from the prior cache. Write errors are swallowed.
 */
export function writeCachedAgentModels(
	result: AgentModelCatalog,
	storage?: Storage,
): void {
	if (result.models.length === 0) {
		return;
	}
	const store = resolveStorage(storage);
	if (!store) {
		return;
	}
	const stored: AgentModelCatalog = {
		defaultModelId: result.defaultModelId,
		defaultThinkingLevel: result.defaultThinkingLevel,
		models: result.models,
	};
	try {
		store.setItem(CACHE_KEY, JSON.stringify(stored));
	} catch {
		// Quota/serialisation failure must not break the query flow.
	}
}
