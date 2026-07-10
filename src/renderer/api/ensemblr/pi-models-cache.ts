import type { ListPiModelsResult } from '@/shared/ipc/contracts/pi-session';

/**
 * localStorage persistence for the Pi model catalog so the picker/settings have
 * the last-known list available instantly on launch while a fresh
 * `pi --list-models` runs in the background (stale-while-revalidate).
 *
 * Only non-empty catalogs are stored: the IPC handler returns an empty result
 * when `pi` is unavailable, and overwriting with that would blank the cache.
 */
const CACHE_KEY = 'ensemblr_pref_pi_models_snapshot';

function resolveStorage(storage?: Storage): Storage | null {
	if (storage) {
		return storage;
	}
	return typeof globalThis.localStorage === 'undefined'
		? null
		: globalThis.localStorage;
}

/** Type guard for a stored catalog — never trust the parsed JSON. */
function isListPiModelsResult(value: unknown): value is ListPiModelsResult {
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
export function readCachedPiModels(
	storage?: Storage,
): ListPiModelsResult | undefined {
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
		if (isListPiModelsResult(parsed) && parsed.models.length > 0) {
			return parsed;
		}
	} catch {
		// Corrupt entry — fall through and report no cache.
	}
	return undefined;
}

/**
 * Persists a catalog. No-op for an empty list so a transient `pi` failure never
 * clobbers the last-known-good cache. Write errors are swallowed.
 */
export function writeCachedPiModels(
	result: ListPiModelsResult,
	storage?: Storage,
): void {
	if (result.models.length === 0) {
		return;
	}
	const store = resolveStorage(storage);
	if (!store) {
		return;
	}
	try {
		store.setItem(CACHE_KEY, JSON.stringify(result));
	} catch {
		// Quota/serialisation failure must not break the query flow.
	}
}
