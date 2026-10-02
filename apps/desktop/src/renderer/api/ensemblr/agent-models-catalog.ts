import type { AgentModelCatalog } from '@/shared/ipc/contracts/agent-models';

/**
 * Pure catalog reconciliation helpers used by the agent-models query before
 * its accepted results reach the localStorage persistence subscription.
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
function providerSet(result: AgentModelCatalog): ReadonlySet<string> {
	return new Set(result.models.map((model) => model.vendor));
}

/**
 * True when `incoming` is missing at least one provider the `cached` catalog
 * has and introduces no provider of its own — i.e. a strictly narrower provider
 * set. Callers temporarily mask this ambiguous shape until it repeats.
 * @param incoming - Freshly fetched catalog.
 * @param cached - Last-known-good cached catalog.
 * @returns Whether the incoming catalog drops providers without adding any.
 */
export function isMissingProviderSubset(
	incoming: AgentModelCatalog,
	cached: AgentModelCatalog,
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

/** Progress while confirming that a live provider-set reduction is authoritative. */
export interface CatalogReconciliationState {
	candidateKey: string | null;
	matchingCandidates: number;
}

/** Number of identical live listings required before accepting a provider removal. */
const NARROWING_CONFIRMATION_TARGET = 2;

/** Returns the stable identity of one live catalog candidate. */
function catalogCandidateKey(catalog: AgentModelCatalog): string {
	return catalog.models
		.map((model) => model.id)
		.sort((left, right) => left.localeCompare(right))
		.join('|');
}

/** Creates the zero state for catalog reconciliation. */
export function initialCatalogReconciliationState(): CatalogReconciliationState {
	return { candidateKey: null, matchingCandidates: 0 };
}

/**
 * Masks one transient cold-start provider omission while allowing a repeated,
 * stable live reduction to retire removed providers from the picker and cache.
 * @param incoming - Latest non-empty catalog discovered from the runtimes.
 * @param cached - Last catalog persisted by the renderer, if any.
 * @param state - Prior provider-reduction confirmation state.
 * @returns Catalog to expose, advanced state, and whether another poll is needed.
 */
export function reconcileAgentModelCatalog(
	incoming: AgentModelCatalog,
	cached: AgentModelCatalog | undefined,
	state: CatalogReconciliationState,
): {
	catalog: AgentModelCatalog;
	pendingNarrowing: boolean;
	state: CatalogReconciliationState;
} {
	if (!cached || !isMissingProviderSubset(incoming, cached)) {
		return {
			catalog: incoming,
			pendingNarrowing: false,
			state: initialCatalogReconciliationState(),
		};
	}

	const candidateKey = catalogCandidateKey(incoming);
	const matchingCandidates =
		state.candidateKey === candidateKey ? state.matchingCandidates + 1 : 1;
	if (matchingCandidates >= NARROWING_CONFIRMATION_TARGET) {
		return {
			catalog: incoming,
			pendingNarrowing: false,
			state: initialCatalogReconciliationState(),
		};
	}
	return {
		catalog: cached,
		pendingNarrowing: true,
		state: { candidateKey, matchingCandidates },
	};
}

/** Poll cadence, in ms, while the Pi catalog is still settling after launch. */
export const PI_MODELS_POLL_MS = 5000;
/** Consecutive unchanged polls that mark the catalog settled (stop polling). */
const STABLE_POLL_TARGET = 2;
/** Hard cap on poll count so a flapping catalog can never poll forever. */
const MAX_POLLS = 12;

/** Immutable progress of the post-launch Pi catalog settling poll. */
export interface AgentModelsPollState {
	providerKey: string | null;
	stablePolls: number;
	totalPolls: number;
}

/** The zero state for a fresh {@link advanceAgentModelsPoll} run. */
export function initialAgentModelsPollState(): AgentModelsPollState {
	return { providerKey: null, stablePolls: 0, totalPolls: 0 };
}

/** Sorted, joined provider identifiers — a stable equality key for a catalog. */
function providerKeyOf(result: AgentModelCatalog): string {
	return [...providerSet(result)]
		.sort((left, right) => left.localeCompare(right))
		.join('|');
}

/**
 * Decides the next `refetchInterval` for the Pi models query and returns the
 * advanced poll state. Keeps polling every {@link PI_MODELS_POLL_MS} while the
 * catalog is empty or still changing, and stops (returns `false`) once the
 * provider set has been non-empty and unchanged for {@link STABLE_POLL_TARGET}
 * polls, or the {@link MAX_POLLS} ceiling is hit.
 *
 * Settling is judged on the catalog the query returns. When reconciliation
 * masks an ambiguous provider reduction, the query resets this state so the
 * next poll can confirm or reject that live candidate. The {@link MAX_POLLS}
 * ceiling bounds the no-cache case where the listing keeps changing.
 * @param data - The catalog the query currently exposes, if any.
 * @param state - The prior poll state.
 * @returns The next interval (or `false` to stop) plus the advanced state.
 */
export function advanceAgentModelsPoll(
	data: AgentModelCatalog | undefined,
	state: AgentModelsPollState,
): { intervalMs: number | false; state: AgentModelsPollState } {
	const providerKey = data && data.models.length > 0 ? providerKeyOf(data) : '';
	const isSettledCandidate = providerKey !== '';
	const isStableTick =
		isSettledCandidate &&
		state.providerKey !== null &&
		providerKey === state.providerKey;
	const stablePolls = isStableTick ? state.stablePolls + 1 : 0;
	const next: AgentModelsPollState = {
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
