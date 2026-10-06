/**
 * Adapts workspace-environment assembly into the {@link SecretValuesPort}
 * `redactText` reads.
 *
 * `redactText` runs once per conversation row, and assembling an environment
 * resolves Infisical over the network and a login-shell `PATH`, so the named
 * value table is cached per workspace for a short window and concurrent callers
 * share one in-flight assembly.
 */
import type { NamedSecretValue } from '../../shared/redaction.ts';
import type { SecretValuesPort } from './ports.ts';

/** How long one workspace's assembled value table is served from the cache. */
const SECRET_VALUES_TTL_MS = 60_000;

/**
 * How long a failed assembly is remembered as "no values". Short, so a
 * transient Infisical outage clears quickly, but long enough that a burst of
 * rows does not retry and log once each.
 */
const FAILED_ASSEMBLY_RETRY_MS = 5_000;

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
}

/** One cached value table and when it stops being served. */
interface CacheEntry {
	expiresAt: number;
	values: Promise<readonly NamedSecretValue[]>;
}

/**
 * Names every redact value after the first environment key, in sorted order,
 * that carries it, so the placeholder says which variable leaked.
 * @param assembly - The assembled environment and its redact values.
 * @returns Each redact value with its name, `SECRET` when no key carries it.
 */
export function nameSecretValues(
	assembly: SecretEnvironmentAssembly,
): readonly NamedSecretValue[] {
	const nameByValue = new Map<string, string>();
	for (const key of Object.keys(assembly.env).sort()) {
		const value = assembly.env[key] as string;
		if (!nameByValue.has(value)) {
			nameByValue.set(value, key);
		}
	}
	return assembly.redactValues.map((value) => ({
		name: nameByValue.get(value) ?? UNNAMED_SECRET,
		value,
	}));
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
}: CreateSecretValuesPortOptions): SecretValuesPort {
	const cache = new Map<string, CacheEntry>();

	/**
	 * Starts one assembly and caches it, shortening the entry's life if it fails.
	 * @param workspaceId - Workspace to assemble.
	 * @returns The entry now in the cache.
	 */
	const load = (workspaceId: string): CacheEntry => {
		const entry: CacheEntry = {
			expiresAt: now() + ttlMs,
			values: assemble(workspaceId)
				.then(nameSecretValues)
				.catch((error: unknown) => {
					console.warn(
						'[agent-control] could not assemble workspace secrets for redaction.',
						{ workspaceId, ...describeFailure(error) },
					);
					if (cache.get(workspaceId) === entry) {
						cache.set(workspaceId, {
							expiresAt: now() + failureRetryMs,
							values: entry.values,
						});
					}
					return [];
				}),
		};
		cache.set(workspaceId, entry);
		return entry;
	};

	return {
		/**
		 * Serves the workspace's named secret values from the cache, assembling
		 * them when the entry is missing or has expired.
		 * @param workspaceId - Workspace whose values to read.
		 * @returns The named values; empty when assembly failed.
		 */
		readSecretValues: (workspaceId) => {
			const cached = cache.get(workspaceId);
			return cached && cached.expiresAt > now()
				? cached.values
				: load(workspaceId).values;
		},
	};
}
