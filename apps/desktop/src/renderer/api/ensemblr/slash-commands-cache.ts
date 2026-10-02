import type { AgentProviderId } from '@/shared/agent-provider';
import type { AgentProviderSlashCommandWire } from '@/shared/ipc/contracts/agent-provider';

/**
 * localStorage persistence for each runtime's slash command catalogue, so the
 * composer menu paints from the last-known list instantly while live discovery
 * runs in the background (stale-while-revalidate).
 *
 * Discovery is expensive — Claude Code's SDK spawns a real `claude` child
 * process — and the in-memory query cache dies with the window, so without this
 * every launch reopens the menu onto a loading state.
 *
 * The catalogue varies by workspace, so one envelope holds an LRU list of
 * `(provider, cwd)` entries rather than an unbounded key per workspace. Recency
 * is fetch time, not open time: a read never writes, which keeps this module a
 * pure reader the way `agent-models-cache.ts` is. With a small cap and a
 * five-minute stale time the two orders barely differ.
 */
export const SLASH_COMMANDS_CACHE_KEY = 'ensemblr_pref_slash_commands_snapshot';
/** Bump whenever the stored command shape changes; a mismatch resets the cache. */
export const SLASH_COMMANDS_CACHE_VERSION = 1;

const MAX_CACHED_WORKSPACES = 8;
// Counted in UTF-16 code units, matching how browsers charge a localStorage
// quota, so this is the ceiling the store itself enforces rather than a byte
// count that would drift from it on non-ASCII descriptions.
const MAX_SERIALIZED_CHARS = 512 * 1024;

/** One cached catalogue, identified by the runtime and workspace it came from. */
interface SlashCommandsCacheEntry {
	commands: readonly AgentProviderSlashCommandWire[];
	cwd: string;
	fetchedAt: number;
	provider: string;
}

/** Versioned envelope wrapping the cached catalogues, most recently fetched first. */
interface SlashCommandsCacheEnvelope {
	entries: SlashCommandsCacheEntry[];
	version: number;
}

/** A cached catalogue and when it was fetched, for seeding a query. */
export interface CachedSlashCommands {
	commands: readonly AgentProviderSlashCommandWire[];
	fetchedAt: number;
}

// Process-lifetime mirror of the parsed envelope. `initialData` runs on every
// render of a composer that has no query data yet, so parsing tens of KB of JSON
// per keystroke is not acceptable; the app is the only writer, so the mirror
// cannot drift. Bypassed entirely when a caller injects its own Storage.
let cacheMirror: SlashCommandsCacheEntry[] | null = null;

/**
 * Resolves the Storage to use and whether the process-wide mirror applies.
 * @param storage - Explicit storage to use, e.g. in tests.
 * @returns The storage and whether reads and writes may use the mirror.
 */
function resolveStorage(storage?: Storage): {
	store: Storage | null;
	useMirror: boolean;
} {
	if (storage) {
		return { store: storage, useMirror: false };
	}
	const store =
		typeof globalThis.localStorage === 'undefined'
			? null
			: globalThis.localStorage;
	return { store, useMirror: true };
}

/** Type guard for one stored command — never trust the parsed JSON. */
function isSlashCommandWire(
	value: unknown,
): value is AgentProviderSlashCommandWire {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.autoSubmit === 'boolean' &&
		typeof candidate.command === 'string' &&
		candidate.command.length > 0 &&
		typeof candidate.description === 'string' &&
		(candidate.source === undefined || typeof candidate.source === 'string') &&
		(candidate.sourceScope === undefined ||
			typeof candidate.sourceScope === 'string')
	);
}

/** Type guard for one stored entry. */
function isCacheEntry(value: unknown): value is SlashCommandsCacheEntry {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.cwd === 'string' &&
		typeof candidate.provider === 'string' &&
		typeof candidate.fetchedAt === 'number' &&
		Array.isArray(candidate.commands) &&
		candidate.commands.every(isSlashCommandWire)
	);
}

/**
 * Parses the stored envelope, treating a missing, corrupt, or
 * version-mismatched entry as an empty cache.
 * @param store - Storage to read from.
 * @returns The validated entries, or an empty list.
 */
function parseEnvelope(store: Storage): SlashCommandsCacheEntry[] {
	const raw = store.getItem(SLASH_COMMANDS_CACHE_KEY);
	if (!raw) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) {
			return [];
		}
		const candidate = parsed as Partial<SlashCommandsCacheEnvelope>;
		if (
			candidate.version !== SLASH_COMMANDS_CACHE_VERSION ||
			!Array.isArray(candidate.entries)
		) {
			return [];
		}
		return candidate.entries.filter(isCacheEntry);
	} catch {
		return [];
	}
}

/**
 * Reads the cache, preferring the process-wide mirror when it applies.
 * @param store - Storage to read from.
 * @param useMirror - Whether the mirror may serve and absorb this read.
 * @returns The cached entries, most recently fetched first.
 */
function loadEntries(
	store: Storage,
	useMirror: boolean,
): SlashCommandsCacheEntry[] {
	if (useMirror && cacheMirror) {
		return cacheMirror;
	}
	const entries = parseEnvelope(store);
	if (useMirror) {
		cacheMirror = entries;
	}
	return entries;
}

/**
 * Drops the oldest entries until the envelope fits the cap and the size budget,
 * so one workspace with a huge catalogue cannot exhaust a shared quota.
 * @param entries - Candidate entries, most recently fetched first.
 * @returns The entries that fit, in the same order.
 */
function fitToBudget(
	entries: readonly SlashCommandsCacheEntry[],
): SlashCommandsCacheEntry[] {
	let kept = entries.slice(0, MAX_CACHED_WORKSPACES);
	while (
		kept.length > 1 &&
		JSON.stringify(kept).length > MAX_SERIALIZED_CHARS
	) {
		kept = kept.slice(0, -1);
	}
	return kept;
}

/**
 * Writes the cache through to storage and the mirror, swallowing write errors.
 * @param store - Storage to write to.
 * @param entries - Entries to persist, most recently fetched first.
 * @param useMirror - Whether the mirror should absorb this write.
 */
function saveEntries(
	store: Storage,
	entries: SlashCommandsCacheEntry[],
	useMirror: boolean,
): void {
	if (useMirror) {
		cacheMirror = entries;
	}
	const envelope: SlashCommandsCacheEnvelope = {
		entries,
		version: SLASH_COMMANDS_CACHE_VERSION,
	};
	try {
		store.setItem(SLASH_COMMANDS_CACHE_KEY, JSON.stringify(envelope));
	} catch {
		// Quota/serialisation failure must not break the query flow.
	}
}

/** Returns true when an entry belongs to the given runtime and workspace. */
function matchesTarget(
	entry: SlashCommandsCacheEntry,
	provider: AgentProviderId,
	cwd: string,
): boolean {
	return entry.provider === provider && entry.cwd === cwd;
}

/**
 * Reads the cached catalogue for one runtime and workspace. Returns `undefined`
 * on a missing, corrupt, or version-mismatched cache and on an empty command
 * list, all of which mean "no usable cache" to the caller.
 * @param provider - Agent runtime whose catalogue to read.
 * @param cwd - Workspace directory the catalogue was resolved against.
 * @param storage - Explicit storage to use, e.g. in tests.
 * @returns The cached commands and their fetch time, or undefined.
 */
export function readCachedSlashCommands(
	provider: AgentProviderId,
	cwd: string,
	storage?: Storage,
): CachedSlashCommands | undefined {
	const { store, useMirror } = resolveStorage(storage);
	if (!store) {
		return undefined;
	}
	const entry = loadEntries(store, useMirror).find((candidate) =>
		matchesTarget(candidate, provider, cwd),
	);
	if (!entry || entry.commands.length === 0) {
		return undefined;
	}
	return { commands: entry.commands, fetchedAt: entry.fetchedAt };
}

/**
 * Persists a catalogue for one runtime and workspace, promoting it to the front
 * of the LRU list and dropping the oldest entries past the cap or byte budget.
 * Writing an empty list is a no-op — callers delete instead, so that "the
 * runtime answered with nothing" is not confused with "nothing was written".
 * @param provider - Agent runtime the catalogue came from.
 * @param cwd - Workspace directory the catalogue was resolved against.
 * @param commands - The freshly discovered commands.
 * @param fetchedAt - Epoch milliseconds the catalogue was discovered.
 * @param storage - Explicit storage to use, e.g. in tests.
 */
export function writeCachedSlashCommands(
	provider: AgentProviderId,
	cwd: string,
	commands: readonly AgentProviderSlashCommandWire[],
	fetchedAt: number,
	storage?: Storage,
): void {
	if (commands.length === 0) {
		return;
	}
	const { store, useMirror } = resolveStorage(storage);
	if (!store) {
		return;
	}
	const kept = loadEntries(store, useMirror).filter(
		(entry) => !matchesTarget(entry, provider, cwd),
	);
	saveEntries(
		store,
		fitToBudget([{ commands, cwd, fetchedAt, provider }, ...kept]),
		useMirror,
	);
}

/**
 * Forgets the cached catalogue for one runtime and workspace, so a runtime that
 * genuinely reports no commands does not leave deleted ones resurrectable.
 * @param provider - Agent runtime whose entry to drop.
 * @param cwd - Workspace directory whose entry to drop.
 * @param storage - Explicit storage to use, e.g. in tests.
 */
export function clearCachedSlashCommands(
	provider: AgentProviderId,
	cwd: string,
	storage?: Storage,
): void {
	const { store, useMirror } = resolveStorage(storage);
	if (!store) {
		return;
	}
	const entries = loadEntries(store, useMirror);
	const kept = entries.filter((entry) => !matchesTarget(entry, provider, cwd));
	if (kept.length === entries.length) {
		return;
	}
	saveEntries(store, kept, useMirror);
}

/**
 * Whether a catalogue is already cached for one runtime and workspace, used to
 * decide whether discovery may be warmed before the menu is ever opened.
 * @param provider - Agent runtime to check.
 * @param cwd - Workspace directory to check.
 * @param storage - Explicit storage to use, e.g. in tests.
 * @returns True when a usable cached catalogue exists.
 */
export function hasCachedSlashCommands(
	provider: AgentProviderId,
	cwd: string,
	storage?: Storage,
): boolean {
	return readCachedSlashCommands(provider, cwd, storage) !== undefined;
}

/**
 * Drops the process-wide mirror so the next read re-parses storage. Tests that
 * exercise the default (non-injected) storage path need this between cases.
 */
export function resetSlashCommandsCacheMirror(): void {
	cacheMirror = null;
}
