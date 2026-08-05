import type { WorkspaceRunTarget } from '../ipc/contracts/workspace-scripts';

/**
 * Single source of truth for reading repository script configuration out of a
 * resolved settings list. Used by the main-process script lifecycle service
 * and the renderer dock; keeping one parser prevents the two processes from
 * drifting on key names or defaults.
 */

/** Minimal shape of one resolved setting entry. */
export interface ResolvedScriptSettingEntry {
	key: string;
	value: unknown;
}

/** Run-script concurrency mode (ADR 0007). */
export type RunScriptMode = 'concurrent' | 'nonconcurrent';

/**
 * Parsed repository script configuration. `setup`/`archive` stay single
 * commands; `run` (ADR 0041) is a list of independently start/stop-able named
 * targets — an empty list means no run script is configured.
 */
export interface WorkspaceScriptSettings {
	/** When true, every configured run target auto-starts after setup exits 0. */
	autoRunAfterSetup: boolean;
	runScriptMode: RunScriptMode;
	runTargets: WorkspaceRunTarget[];
	scripts: { archive?: string; setup?: string };
}

const SINGLE_SCRIPT_KINDS = ['archive', 'setup'] as const;

/** Id assigned to the legacy single-string `scripts.run` shape. */
export const DEFAULT_RUN_TARGET_ID = 'default';

/**
 * Extracts the configured script commands, run targets, run mode, and
 * auto-run flag from resolved repository settings. Blank or non-string
 * `setup`/`archive` commands are treated as unconfigured; unknown run modes
 * fall back to `concurrent`.
 * @param settings - Resolved settings entries (repository scope).
 * @returns The parsed {@link WorkspaceScriptSettings}.
 */
export function parseWorkspaceScriptSettings(
	settings: readonly ResolvedScriptSettingEntry[],
): WorkspaceScriptSettings {
	const scripts: { archive?: string; setup?: string } = {};

	for (const kind of SINGLE_SCRIPT_KINDS) {
		const value = settings.find(
			(setting) => setting.key === `scripts.${kind}`,
		)?.value;

		if (typeof value === 'string' && value.trim()) {
			scripts[kind] = value;
		}
	}

	const runValue = settings.find(
		(setting) => setting.key === 'scripts.run',
	)?.value;
	const runModeValue = settings.find(
		(setting) => setting.key === 'runScriptMode',
	)?.value;
	const autoRunValue = settings.find(
		(setting) => setting.key === 'autoRunAfterSetup',
	)?.value;

	return {
		autoRunAfterSetup: autoRunValue === true,
		runScriptMode:
			runModeValue === 'nonconcurrent' ? 'nonconcurrent' : 'concurrent',
		runTargets: parseRunTargets(runValue),
		scripts,
	};
}

/**
 * Normalizes a resolved `scripts.run` candidate value into an ordered list of
 * run targets. Accepts the legacy single-string shape, an array of
 * `{ name?, command, id? }` entries, or anything else (treated as unset).
 * @param value - Resolved `scripts.run` candidate value.
 * @returns Ordered, deduplicated-id run targets.
 */
function parseRunTargets(value: unknown): WorkspaceRunTarget[] {
	if (typeof value === 'string') {
		return value.trim()
			? [{ command: value, id: DEFAULT_RUN_TARGET_ID, name: '' }]
			: [];
	}

	if (!Array.isArray(value)) {
		return [];
	}

	const usedIds = new Set<string>();
	const targets: WorkspaceRunTarget[] = [];

	for (const entry of value) {
		const target = parseRunTargetEntry(entry, usedIds);

		if (target) {
			targets.push(target);
			usedIds.add(target.id);
		}
	}

	return targets;
}

/**
 * Reads the `{ command, name, id }` fields off one unknown `scripts.run` array
 * entry as raw (untrimmed) strings, or `null` when the entry is not an object.
 * Callers apply their own trimming, blank-filtering, and id policy — the shared
 * parser derives a slug id and drops blank commands, while the Settings editor
 * keeps blanks and mints a UUID — so this only covers the shared shape read.
 * @param entry - Candidate array element.
 * @returns The raw string fields, or `null` for a non-object entry.
 */
export function readRunTargetEntry(
	entry: unknown,
): { command: string; id: string; name: string } | null {
	if (typeof entry !== 'object' || entry === null) {
		return null;
	}

	const record = entry as Record<string, unknown>;

	return {
		command: typeof record.command === 'string' ? record.command : '',
		id: typeof record.id === 'string' ? record.id : '',
		name: typeof record.name === 'string' ? record.name : '',
	};
}

/**
 * Validates and normalizes one array entry of a `scripts.run` list, deriving
 * a stable id from an explicit `id`, or a slug of `name`, when the entry
 * doesn't carry one — de-duplicated against ids already assigned earlier in
 * the same list.
 * @param entry - Candidate array element.
 * @param usedIds - Ids already assigned to earlier entries in this list.
 * @returns A normalized target, or `null` when the entry has no usable command.
 */
function parseRunTargetEntry(
	entry: unknown,
	usedIds: ReadonlySet<string>,
): WorkspaceRunTarget | null {
	const raw = readRunTargetEntry(entry);

	if (!raw) {
		return null;
	}

	const command = raw.command.trim();

	if (!command) {
		return null;
	}

	const name = raw.name.trim();
	const explicitId = raw.id.trim();

	return {
		command,
		id: explicitId || uniqueSlug(name, usedIds),
		name,
	};
}

/**
 * Slugifies `name` into a stable, unique id, suffixing with an incrementing
 * counter on collision. Falls back to a positional id when `name` is blank
 * or slugifies to nothing.
 * @param name - Display name to derive an id from.
 * @param usedIds - Ids already assigned to earlier entries in the same list.
 * @returns A slug not present in `usedIds`.
 */
function uniqueSlug(name: string, usedIds: ReadonlySet<string>): string {
	const base =
		name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'run';

	if (!usedIds.has(base)) {
		return base;
	}

	let suffix = 2;
	while (usedIds.has(`${base}-${suffix}`)) {
		suffix += 1;
	}

	return `${base}-${suffix}`;
}
