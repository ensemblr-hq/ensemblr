import { LinearServiceError } from './linear-client.ts';
import type { LinearStore, LinearSyncStateRecord } from './linear-store.ts';

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_FAILURE_COOLDOWN_MS = 30 * 1000;
const MAX_TRANSIENT_SCOPES = 64;

/**
 * Whether one account's scope needs a remote sync before it is read. Omit
 * `store` for a scope whose key the caller invents rather than fixes, so its
 * freshness is held in memory instead of persisted.
 */
export interface NeedsSyncOptions {
	accountId: string;
	refresh: boolean;
	scope: string;
	store?: LinearStore | undefined;
}

/**
 * One account's scope sync. `run` performs the remote work and returns the
 * cursor to record, or null when the scope is not paginated. Omit `store` for a
 * transient scope, as {@link NeedsSyncOptions} describes.
 */
export interface RunScopeSyncOptions {
	accountId: string;
	run: () => Promise<string | null>;
	scope: string;
	store?: LinearStore | undefined;
}

/**
 * Decides when Linear data is refetched, keeps concurrent readers from each
 * starting their own copy of the same remote work, and remembers why the last
 * attempt failed so a cached answer can still say what is wrong.
 */
export interface LinearSyncCoordinator {
	isStale: (syncedAt: string | null | undefined) => boolean;
	lastFailure: (accountId: string, scope: string) => unknown;
	needsSync: (options: NeedsSyncOptions) => boolean;
	runScopeSync: (options: RunScopeSyncOptions) => Promise<void>;
	share: <T>(key: string, run: () => Promise<T>) => Promise<T>;
}

/** Options for {@link createLinearSyncCoordinator}. */
export interface CreateLinearSyncCoordinatorOptions {
	failureCooldownMs?: number;
	now?: () => Date;
	staleAfterMs?: number;
}

/**
 * Builds the sync coordinator the Linear service reads through.
 *
 * Three jobs, all of which the service used to do badly or not at all. It shares
 * an in-flight remote read rather than letting the browse list, the dashboard,
 * and an agent call each start their own. It holds a scope back for a cooldown
 * after a failure, because the failure path leaves `syncedAt` untouched — so
 * without one, an unreachable or rate-limited Linear turns every subsequent read
 * into another blocking retry. And it keeps each scope's freshness: in
 * `linear_sync_state` for a scope with a fixed key, in a bounded in-memory map
 * for one whose key a caller invents.
 *
 * The live failure a cached read reports comes from memory, so it lasts as long
 * as the process. The `status` and `errorCode` on the persisted row are the
 * durable record of the last attempt, for the support bundle rather than for a
 * reader inside the app.
 * @param options - Freshness window, failure cooldown, and optional clock.
 * @returns A fresh {@link LinearSyncCoordinator}.
 */
export function createLinearSyncCoordinator({
	failureCooldownMs = DEFAULT_FAILURE_COOLDOWN_MS,
	now = () => new Date(),
	staleAfterMs = DEFAULT_STALE_AFTER_MS,
}: CreateLinearSyncCoordinatorOptions = {}): LinearSyncCoordinator {
	const inFlight = new Map<string, Promise<unknown>>();
	const cooldownUntil = new Map<string, number>();
	const failures = new Map<string, unknown>();
	const transientSyncedAt = new Map<string, string | null>();

	/**
	 * Decide whether a cached timestamp has aged past the staleness window.
	 * @param syncedAt - ISO timestamp of the last sync, if any.
	 * @returns True when the value is missing or older than the stale threshold.
	 */
	function isStale(syncedAt: string | null | undefined): boolean {
		if (!syncedAt) {
			return true;
		}

		return now().getTime() - Date.parse(syncedAt) > staleAfterMs;
	}

	/**
	 * How long to hold a scope back after one failed attempt. A rate-limited
	 * account names its own window, and retrying inside it earns another 429.
	 * @param error - The failure the attempt raised.
	 * @returns The cooldown in milliseconds.
	 */
	function cooldownFor(error: unknown): number {
		const retryAfter =
			error instanceof LinearServiceError ? error.retryAfterSeconds : null;

		return Math.max(failureCooldownMs, (retryAfter ?? 0) * 1000);
	}

	/**
	 * Whether a scope is still inside the cooldown a recent failure earned it.
	 * @param key - The scope's coalescing key.
	 * @returns True while the scope is held back.
	 */
	function isCoolingDown(key: string): boolean {
		const until = cooldownUntil.get(key);

		if (until === undefined) {
			return false;
		}

		if (now().getTime() >= until) {
			cooldownUntil.delete(key);
			return false;
		}

		return true;
	}

	/**
	 * The key one account's scope is coalesced and cooled down under.
	 * @param accountId - Account being synced.
	 * @param scope - Sync scope within that account.
	 * @returns The composite key.
	 */
	function scopeKey(accountId: string, scope: string): string {
		return `${accountId}:${scope}`;
	}

	/**
	 * Record a transient scope's last outcome, dropping the least recently
	 * touched scopes once the map is full. A search scope's key is the text
	 * someone typed, so without a bound these maps would grow with every term
	 * ever searched; a scope's cooldown and failure are dropped alongside it.
	 * @param key - The scope's coalescing key.
	 * @param syncedAt - When it last succeeded, or null when it never has.
	 */
	function rememberTransient(key: string, syncedAt: string | null): void {
		transientSyncedAt.delete(key);
		transientSyncedAt.set(key, syncedAt);

		while (transientSyncedAt.size > MAX_TRANSIENT_SCOPES) {
			const oldest = transientSyncedAt.keys().next().value;

			if (oldest === undefined) {
				return;
			}

			transientSyncedAt.delete(oldest);
			cooldownUntil.delete(oldest);
			failures.delete(oldest);
		}
	}

	/**
	 * When a scope last synced, read from wherever that scope keeps it.
	 * @param accountId - Account being synced.
	 * @param scope - Sync scope within that account.
	 * @param store - Store holding the scope's row, absent when it is transient.
	 * @returns The last sync timestamp, or null when there has never been one.
	 */
	function lastSyncedAt(
		accountId: string,
		scope: string,
		store: LinearStore | undefined,
	): string | null {
		if (store) {
			return store.getSyncState(accountId, scope)?.syncedAt ?? null;
		}

		return transientSyncedAt.get(scopeKey(accountId, scope)) ?? null;
	}

	/**
	 * Record one attempt's outcome where its scope keeps freshness.
	 * @param state - The sync-state the attempt leaves behind.
	 * @param store - Store to persist it in, absent when the scope is transient.
	 */
	function recordAttempt(
		state: LinearSyncStateRecord,
		store: LinearStore | undefined,
	): void {
		if (store) {
			store.setSyncState(state);
			return;
		}

		rememberTransient(scopeKey(state.accountId, state.scope), state.syncedAt);
	}

	/**
	 * Share one in-flight remote read across every caller that asks for it while
	 * it is still running, so concurrent surfaces cost one request rather than one
	 * each.
	 * @param key - Identity of the work being shared.
	 * @param run - Performs the work when nothing is in flight.
	 * @returns The shared result.
	 */
	function share<T>(key: string, run: () => Promise<T>): Promise<T> {
		const running = inFlight.get(key) as Promise<T> | undefined;

		if (running) {
			return running;
		}

		const started = run().finally(() => {
			inFlight.delete(key);
		});

		inFlight.set(key, started);

		return started;
	}

	return {
		isStale,

		lastFailure: (accountId, scope) => failures.get(scopeKey(accountId, scope)),

		needsSync: ({ accountId, refresh, scope, store }) => {
			if (refresh) {
				return true;
			}

			if (isCoolingDown(scopeKey(accountId, scope))) {
				return false;
			}

			return isStale(lastSyncedAt(accountId, scope, store));
		},

		runScopeSync: ({ accountId, run, scope, store }) => {
			const key = scopeKey(accountId, scope);

			return share(key, async () => {
				const previous = lastSyncedAt(accountId, scope, store);

				recordAttempt(
					{
						accountId,
						cursor: null,
						errorCode: null,
						scope,
						status: 'syncing',
						syncedAt: previous,
					},
					store,
				);

				try {
					const cursor = await run();

					recordAttempt(
						{
							accountId,
							cursor,
							errorCode: null,
							scope,
							status: 'idle',
							syncedAt: now().toISOString(),
						},
						store,
					);
					cooldownUntil.delete(key);
					failures.delete(key);
				} catch (error) {
					recordAttempt(
						{
							accountId,
							cursor: null,
							errorCode:
								error instanceof LinearServiceError ? error.code : 'network',
							scope,
							status: 'error',
							syncedAt: previous,
						},
						store,
					);
					cooldownUntil.set(key, now().getTime() + cooldownFor(error));
					failures.set(key, error);
					throw error;
				}
			});
		},

		share,
	};
}
