import type { ListPiModelsResult } from '@/shared/ipc/contracts/pi-session';

/**
 * Pure catalog reconciliation helpers shared by the Pi models query, its
 * localStorage cache, and the query-cache persistence subscription.
 *
 * On a cold launch `pi --list-models` resolves providers incrementally: the
 * network/subscription providers (Claude, GPT) can be absent from the first
 * successful listing while local providers are already present. Treating that
 * partial listing as authoritative blanks the picker (and poisons the cache)
 * whenever the only *visible* providers are the ones still resolving. These
 * helpers detect a partial listing by comparing provider sets, and drive a
 * self-stopping poll that refreshes the catalog until it settles.
 */

/** Collects the distinct provider identifiers present in a catalog. */
function providerSet(result: ListPiModelsResult): ReadonlySet<string> {
	return new Set(result.models.map((model) => model.provider));
}

/**
 * True when `incoming` is missing at least one provider the `cached` catalog
 * has and introduces no provider of its own — i.e. a strictly narrower provider
 * set. Such a listing is a transient cold-start partial, not an authoritative
 * shrink, so callers keep the richer cached catalog instead.
 * @param incoming - Freshly fetched catalog.
 * @param cached - Last-known-good cached catalog.
 * @returns Whether the incoming catalog drops providers without adding any.
 */
export function isMissingProviderSubset(
	incoming: ListPiModelsResult,
	cached: ListPiModelsResult,
): boolean {
	const incomingProviders = providerSet(incoming);
	const cachedProviders = providerSet(cached);
	if (incomingProviders.size >= cachedProviders.size) {
		return false;
	}
	for (const provider of incomingProviders) {
		if (!cachedProviders.has(provider)) {
			return false;
		}
	}
	return true;
}

/** Poll cadence, in ms, while the Pi catalog is still settling after launch. */
export const PI_MODELS_POLL_MS = 5000;
/** Consecutive unchanged polls that mark the catalog settled (stop polling). */
const STABLE_POLL_TARGET = 2;
/** Hard cap on poll count so a flapping catalog can never poll forever. */
const MAX_POLLS = 12;

/** Immutable progress of the post-launch Pi catalog settling poll. */
export interface PiModelsPollState {
	providerKey: string | null;
	stablePolls: number;
	totalPolls: number;
}

/** The zero state for a fresh {@link advancePiModelsPoll} run. */
export function initialPiModelsPollState(): PiModelsPollState {
	return { providerKey: null, stablePolls: 0, totalPolls: 0 };
}

/** Sorted, joined provider identifiers — a stable equality key for a catalog. */
function providerKeyOf(result: ListPiModelsResult): string {
	return [...providerSet(result)].sort().join('|');
}

/**
 * Decides the next `refetchInterval` for the Pi models query and returns the
 * advanced poll state. Keeps polling every {@link PI_MODELS_POLL_MS} while the
 * catalog is empty or still changing, and stops (returns `false`) once the
 * provider set has been non-empty and unchanged for {@link STABLE_POLL_TARGET}
 * polls, or the {@link MAX_POLLS} ceiling is hit.
 * @param data - The query's current raw catalog data, if any.
 * @param state - The prior poll state.
 * @returns The next interval (or `false` to stop) plus the advanced state.
 */
export function advancePiModelsPoll(
	data: ListPiModelsResult | undefined,
	state: PiModelsPollState,
): { intervalMs: number | false; state: PiModelsPollState } {
	const providerKey = data && data.models.length > 0 ? providerKeyOf(data) : '';
	const isSettledCandidate = providerKey !== '';
	const isStableTick =
		isSettledCandidate &&
		state.providerKey !== null &&
		providerKey === state.providerKey;
	const stablePolls = isStableTick ? state.stablePolls + 1 : 0;
	const next: PiModelsPollState = {
		providerKey,
		stablePolls,
		totalPolls: state.totalPolls + 1,
	};
	const settled = isSettledCandidate && stablePolls >= STABLE_POLL_TARGET;
	if (settled || next.totalPolls >= MAX_POLLS) {
		return { intervalMs: false, state: next };
	}
	return { intervalMs: PI_MODELS_POLL_MS, state: next };
}
