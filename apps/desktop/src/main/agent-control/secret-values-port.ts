/**
 * Adapts workspace-environment assembly into the {@link SecretValuesPort}
 * `redactText` reads.
 *
 * `redactText` runs once per conversation row, and assembling an environment
 * resolves Infisical over the network and a login-shell `PATH`, so the named
 * value table is cached per workspace. Only a workspace's first read waits for
 * an assembly: after that an expired table is served as it stands while one
 * background refresh replaces it, so a row is never held up by the network and
 * a secret that changed is redacted from the next refresh on, up to a window
 * later.
 */
import {
	isDistinctiveSecretValue,
	type NamedSecretValue,
} from '../../shared/redaction.ts';
import type { SecretValuesPort } from './ports.ts';

/** How long one workspace's assembled value table is served before a refresh. */
const SECRET_VALUES_TTL_MS = 60_000;

/**
 * How long a failed assembly waits before the next attempt. Short, so a
 * transient Infisical outage clears quickly, but long enough that a burst of
 * rows does not retry and log once each.
 */
const FAILED_ASSEMBLY_RETRY_MS = 5_000;

/**
 * How long a workspace's table survives without a read, so the values of an
 * archived or closed workspace do not stay in memory for the app's lifetime.
 */
const IDLE_EVICTION_MS = 10 * 60_000;

/** Placeholder name for a secret value no environment key carries. */
const UNNAMED_SECRET = 'SECRET';

/** The slice of a workspace-environment assembly the port reads. */
export interface SecretEnvironmentAssembly {
	env: Readonly<Record<string, string>>;
	redactValues: readonly string[];
}

/** Options for {@link createSecretValuesPort}; the clock and windows are injectable for tests. */
interface CreateSecretValuesPortOptions {
	assemble: (workspaceId: string) => Promise<SecretEnvironmentAssembly>;
	now?: () => number;
	ttlMs?: number;
	failureRetryMs?: number;
	idleEvictionMs?: number;
}

/** One workspace's cached table, its freshness, and any refresh in flight. */
interface CacheEntry {
	freshUntil: number;
	/** The last successfully assembled table; null until one succeeds. */
	lastGood: readonly NamedSecretValue[] | null;
	lastReadAt: number;
	refreshing: Promise<readonly NamedSecretValue[]> | null;
}

/**
 * Groups the environment's keys by the value they carry, in sorted key order.
 * @param env - The assembled environment.
 * @returns Every key carrying each value, first key first.
 */
function keysByValue(
	env: Readonly<Record<string, string>>,
): ReadonlyMap<string, readonly string[]> {
	const grouped = new Map<string, readonly string[]>();
	for (const key of Object.keys(env).sort()) {
		const value = env[key] as string;
		grouped.set(value, [...(grouped.get(value) ?? []), key]);
	}
	return grouped;
}

/**
 * Keeps the redact values distinctive enough to replace in a transcript and
 * names each after the first environment key, in sorted order, that carries it,
 * so the placeholder says which variable leaked.
 * @param assembly - The assembled environment and its redact values.
 * @returns Each kept value with its name, `SECRET` when no key carries it.
 */
export function nameDistinctiveSecretValues(
	assembly: SecretEnvironmentAssembly,
): readonly NamedSecretValue[] {
	const keysFor = keysByValue(assembly.env);
	return assembly.redactValues.flatMap((value) => {
		const keys = keysFor.get(value) ?? [];
		return isDistinctiveSecretValue(value, keys)
			? [{ name: keys[0] ?? UNNAMED_SECRET, value }]
			: [];
	});
}

/**
 * Describes an assembly failure without anything it might carry, since a
 * message from deep in the environment layer could quote a value.
 * @param error - What the assembly rejected with.
 * @returns The error's class and code, never its message.
 */
function describeFailure(error: unknown): Record<string, unknown> {
	if (!(error instanceof Error)) {
		return { kind: typeof error };
	}
	const code = (error as { code?: unknown }).code;
	return { code: typeof code === 'string' ? code : null, kind: error.name };
}

/**
 * Builds the cached secret-values port over a workspace-environment assembler.
 * @param options - The assembler, plus clock and window overrides for tests.
 * @returns A port that never rejects.
 */
export function createSecretValuesPort({
	assemble,
	now = Date.now,
	ttlMs = SECRET_VALUES_TTL_MS,
	failureRetryMs = FAILED_ASSEMBLY_RETRY_MS,
	idleEvictionMs = IDLE_EVICTION_MS,
}: CreateSecretValuesPortOptions): SecretValuesPort {
	const cache = new Map<string, CacheEntry>();

	/**
	 * Replaces fields of a workspace's entry, unless it was evicted meanwhile.
	 * @param workspaceId - Workspace whose entry to update.
	 * @param patch - Fields to replace.
	 */
	const update = (workspaceId: string, patch: Partial<CacheEntry>): void => {
		const current = cache.get(workspaceId);
		if (current) {
			cache.set(workspaceId, { ...current, ...patch });
		}
	};

	/**
	 * Drops every entry no read has touched within the idle window.
	 * @param at - Current time, in epoch milliseconds.
	 */
	const evictIdle = (at: number): void => {
		for (const [workspaceId, entry] of cache) {
			if (at - entry.lastReadAt > idleEvictionMs) {
				cache.delete(workspaceId);
			}
		}
	};

	/**
	 * Starts one assembly for a workspace and records it as in flight. A
	 * failure keeps the last good table and waits briefly before the next try.
	 * @param workspaceId - Workspace to assemble.
	 * @returns The refreshed table; the last good one, or none, on failure.
	 */
	const refresh = (
		workspaceId: string,
	): Promise<readonly NamedSecretValue[]> => {
		const refreshing = Promise.resolve()
			.then(() => assemble(workspaceId))
			.then(
				(assembly) => {
					const values = nameDistinctiveSecretValues(assembly);
					update(workspaceId, {
						freshUntil: now() + ttlMs,
						lastGood: values,
						refreshing: null,
					});
					return values;
				},
				(error: unknown) => {
					console.warn(
						'[agent-control] could not assemble workspace secrets for redaction.',
						{ workspaceId, ...describeFailure(error) },
					);
					update(workspaceId, {
						freshUntil: now() + failureRetryMs,
						refreshing: null,
					});
					return cache.get(workspaceId)?.lastGood ?? [];
				},
			);
		update(workspaceId, { refreshing });
		return refreshing;
	};

	return {
		/**
		 * Serves the workspace's named secret values. A fresh table is served
		 * as it stands; an expired one is served too while a single refresh runs
		 * behind it; only a workspace with no table yet waits for an assembly.
		 * @param workspaceId - Workspace whose values to read.
		 * @returns The named values; empty when no assembly has succeeded.
		 */
		readSecretValues: (workspaceId) => {
			const at = now();
			evictIdle(at);
			const entry: CacheEntry = cache.get(workspaceId) ?? {
				freshUntil: 0,
				lastGood: null,
				lastReadAt: at,
				refreshing: null,
			};
			cache.set(workspaceId, { ...entry, lastReadAt: at });
			if (entry.freshUntil > at) {
				return Promise.resolve(entry.lastGood ?? []);
			}
			const refreshing = entry.refreshing ?? refresh(workspaceId);
			return entry.lastGood ? Promise.resolve(entry.lastGood) : refreshing;
		},
	};
}
