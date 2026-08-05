/**
 * Named run scripts: the repository-configured shortcuts the dock's Run button
 * launches. A repository declares any number of them (`[scripts.run.<name>]` in
 * `.ensemblr/settings.toml`, or personal rows in SQLite); this module owns the
 * wire shape, the curated icon vocabulary, and the pure selectors both the main
 * process and the renderer resolve them with.
 */

/**
 * Icon names a run script may carry. Curated rather than open-ended so the
 * renderer can map every name to a statically imported lucide component and a
 * committed config cannot reference an icon that fails to render.
 */
export const RUN_SCRIPT_ICON_NAMES = [
	'activity',
	'badge-check',
	'blocks',
	'book-open',
	'box',
	'bug',
	'calculator',
	'cloud',
	'code',
	'cog',
	'component',
	'container',
	'cpu',
	'database',
	'download',
	'eye',
	'file-code',
	'flame',
	'flask-conical',
	'folder',
	'gauge',
	'git-branch',
	'git-merge',
	'git-pull-request',
	'globe',
	'hammer',
	'hard-drive',
	'key',
	'layers',
	'layout-dashboard',
	'list-checks',
	'lock',
	'microscope',
	'monitor',
	'network',
	'package',
	'paintbrush',
	'palette',
	'play',
	'plug',
	'refresh-cw',
	'repeat',
	'rocket',
	'search',
	'send',
	'server',
	'settings',
	'shield-check',
	'smartphone',
	'sparkles',
	'terminal',
	'test-tube',
	'timer',
	'trending-up',
	'upload',
	'wrench',
	'zap',
] as const;

/** One of the curated run-script icon names. */
export type RunScriptIconName = (typeof RUN_SCRIPT_ICON_NAMES)[number];

/** Icon used when a script declares none, or declares one outside the curated set. */
export const DEFAULT_RUN_SCRIPT_ICON: RunScriptIconName = 'play';

/** Name given to the implicit script upgraded from a legacy `run = "..."` string. */
export const LEGACY_RUN_SCRIPT_NAME = 'run';

/**
 * Environment Ensemblr runs workspaces in. Conductor's `available_in` also
 * names cloud sandboxes; Ensemblr is local-only, so a script that excludes this
 * value is filtered out rather than shown and failed at launch.
 */
export const LOCAL_RUN_ENVIRONMENT = 'local';

/** One repository-configured run script. */
export interface RunScriptDefinition {
	/** Environments the script is offered in, or null when it declares none. */
	availableIn: readonly string[] | null;
	command: string;
	icon: RunScriptIconName;
	/** True when the repository flags this script as the ⌘R default. */
	isDefault: boolean;
	name: string;
}

/**
 * A field this module rejected, reported so a config loader can raise its own
 * diagnostic against the right path. Normalisation always succeeds — an issue
 * records what was ignored, never what stopped the parse.
 */
export type RunScriptIssue =
	| {
			/** What the field accepts, phrased for a diagnostic message. */
			expected: string;
			/** Rejected field, or null when the whole entry is unusable. */
			field: string | null;
			kind: 'invalid';
			/** Name of the script the issue belongs to. */
			script: string;
	  }
	| { field: string; kind: 'unsupported'; script: string };

const RUN_SCRIPT_ICON_SET: ReadonlySet<string> = new Set(RUN_SCRIPT_ICON_NAMES);

/** Keys a `[scripts.run.<name>]` table may declare; anything else is reported. */
const RUN_SCRIPT_TABLE_KEYS: ReadonlySet<string> = new Set([
	'available_in',
	'command',
	'default',
	'icon',
]);

/**
 * Narrows a candidate to a curated run-script icon name.
 * @param value - Candidate read from config or persisted settings.
 * @returns True when the value is one of {@link RUN_SCRIPT_ICON_NAMES}.
 */
export function isRunScriptIconName(
	value: unknown,
): value is RunScriptIconName {
	return typeof value === 'string' && RUN_SCRIPT_ICON_SET.has(value);
}

/**
 * Coerces an arbitrary list of run-script records into validated definitions,
 * accepting both the TOML spelling (`default`, `available_in`) and the
 * camelCase spelling persisted to SQLite. Entries without a usable name and
 * command are dropped, names are de-duplicated first-wins, and at most one
 * entry keeps its default flag.
 * @param value - Raw value read from resolved settings or a persisted JSON row.
 * @param issues - Optional sink collecting the fields that were rejected.
 * @returns The validated definitions, in declaration order.
 */
export function normalizeRunScripts(
	value: unknown,
	issues?: RunScriptIssue[],
): RunScriptDefinition[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const entries: [string, Record<string, unknown>][] = [];

	for (const entry of value) {
		const record = asRunScriptRecord(entry);
		const name = record ? trimmedString(record.name) : null;

		if (record && name) {
			entries.push([name, record]);
		}
	}

	return collectRunScripts(entries, { issues, reportUnsupported: false });
}

/**
 * Coerces a `[scripts.run.<name>]` TOML table into validated definitions, using
 * each table key as the script name. Shares every field rule with
 * {@link normalizeRunScripts} so a committed config and a personal SQLite row
 * can never be judged by different rules, and reports unrecognised keys because
 * a hand-written config is where a typo actually happens.
 * @param value - Raw `scripts.run` table.
 * @param issues - Optional sink collecting the fields that were rejected.
 * @returns The validated definitions, in declaration order.
 */
export function normalizeRunScriptTable(
	value: unknown,
	issues?: RunScriptIssue[],
): RunScriptDefinition[] {
	const table = asRunScriptRecord(value);

	if (!table) {
		return [];
	}

	const entries: [string, Record<string, unknown>][] = [];

	for (const [key, entry] of Object.entries(table)) {
		const record = asRunScriptRecord(entry);

		if (!record) {
			issues?.push({
				expected: 'a table',
				field: null,
				kind: 'invalid',
				script: key,
			});
			continue;
		}

		const name = key.trim();

		if (!name) {
			issues?.push({
				expected: 'a non-empty script name',
				field: null,
				kind: 'invalid',
				script: key,
			});
			continue;
		}

		entries.push([name, record]);
	}

	return collectRunScripts(entries, { issues, reportUnsupported: true });
}

/**
 * Keeps the run scripts Ensemblr can actually launch: those declaring no
 * environments, or declaring the local one.
 * @param scripts - Normalized run scripts.
 * @returns The launchable subset, in declaration order.
 */
export function selectAvailableRunScripts(
	scripts: readonly RunScriptDefinition[],
): RunScriptDefinition[] {
	return scripts.filter(isRunScriptAvailableLocally);
}

/**
 * Reports whether Ensemblr offers a script at all: it either declares no
 * environments, or names the local one.
 * @param script - The script to test.
 * @returns True when the script is launchable here.
 */
export function isRunScriptAvailableLocally(
	script: RunScriptDefinition,
): boolean {
	return (
		script.availableIn === null ||
		script.availableIn.includes(LOCAL_RUN_ENVIRONMENT)
	);
}

/**
 * Picks the script the Run button starts when the user has expressed no
 * preference: the one the repository flags as default, else the first.
 * @param scripts - Normalized run scripts.
 * @returns The default script, or null when none are configured.
 */
export function selectDefaultRunScript(
	scripts: readonly RunScriptDefinition[],
): RunScriptDefinition | null {
	return scripts.find((script) => script.isDefault) ?? scripts[0] ?? null;
}

/**
 * Resolves the script a launch request targets. An explicitly named script that
 * is not configured resolves to null rather than silently falling back, so a
 * stale name reports a failure instead of running the wrong command.
 * @param scripts - Normalized run scripts.
 * @param name - Requested script name, or null/undefined for the default.
 * @returns The matching script, or null.
 */
export function resolveRunScript(
	scripts: readonly RunScriptDefinition[],
	name?: string | null,
): RunScriptDefinition | null {
	if (!name) {
		return selectDefaultRunScript(scripts);
	}

	return scripts.find((script) => script.name === name) ?? null;
}

/**
 * Renders a script's config name as a UI label: `dev-server` becomes
 * `Dev server`, matching how the dock and settings list present them.
 * @param name - The script's configured name.
 * @returns The display label.
 */
export function formatRunScriptLabel(name: string): string {
	const spaced = name.replace(/[-_]+/g, ' ').trim();

	return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : name;
}

/**
 * Folds validated entries into the final list: names de-duplicate first-wins
 * and at most one entry keeps its default flag, so the dock never has to break
 * a tie.
 * @param entries - Candidate records paired with their resolved names.
 * @param options - Issue sink, and whether unrecognised keys are reported.
 * @returns The validated definitions, in declaration order.
 */
function collectRunScripts(
	entries: readonly (readonly [string, Record<string, unknown>])[],
	options: { issues?: RunScriptIssue[]; reportUnsupported: boolean },
): RunScriptDefinition[] {
	const seenNames = new Set<string>();
	const normalized: RunScriptDefinition[] = [];
	let defaultTaken = false;

	for (const [name, record] of entries) {
		const definition = readRunScriptFields(name, record, options);

		if (!definition) {
			continue;
		}

		if (seenNames.has(name)) {
			options.issues?.push({
				expected: 'a name no other run script uses',
				field: null,
				kind: 'invalid',
				script: name,
			});
			continue;
		}

		seenNames.add(name);

		if (definition.isDefault && defaultTaken) {
			options.issues?.push({
				expected: 'the only run script flagged as default',
				field: 'default',
				kind: 'invalid',
				script: name,
			});
			normalized.push({ ...definition, isDefault: false });
			continue;
		}

		defaultTaken = defaultTaken || definition.isDefault;
		normalized.push(definition);
	}

	return normalized;
}

/**
 * Validates one run-script record's fields. A mistyped `icon`, `default`, or
 * `available_in` only costs that field, so one bad key never hides an otherwise
 * launchable script; an unusable `command` drops the entry.
 * @param name - The script's resolved name.
 * @param record - Candidate record.
 * @param options - Issue sink, and whether unrecognised keys are reported.
 * @returns The definition, or null when it carries no usable command.
 */
function readRunScriptFields(
	name: string,
	record: Record<string, unknown>,
	options: { issues?: RunScriptIssue[]; reportUnsupported: boolean },
): RunScriptDefinition | null {
	const { issues } = options;
	const command = readRunScriptCommand(record, name, issues);
	const icon = readRunScriptIcon(record, name, issues);
	const isDefault = readRunScriptDefault(record, name, issues);
	const availableIn = readRunScriptAvailability(record, name, issues);

	if (options.reportUnsupported) {
		for (const field of Object.keys(record)) {
			if (!RUN_SCRIPT_TABLE_KEYS.has(field)) {
				issues?.push({ field, kind: 'unsupported', script: name });
			}
		}
	}

	return command ? { availableIn, command, icon, isDefault, name } : null;
}

/**
 * Reads a script's `command`, which is the one field it cannot do without.
 * @param record - Candidate record.
 * @param script - The script's resolved name.
 * @param issues - Optional sink the mismatch is reported to.
 * @returns The trimmed command, or null.
 */
function readRunScriptCommand(
	record: Record<string, unknown>,
	script: string,
	issues?: RunScriptIssue[],
): string | null {
	const command = trimmedString(record.command);

	if (command) {
		return command;
	}

	issues?.push({
		expected: 'a non-empty string',
		field: 'command',
		kind: 'invalid',
		script,
	});

	return null;
}

/**
 * Reads a script's `icon`, falling back to the default when it is absent or
 * outside the curated set.
 * @param record - Candidate record.
 * @param script - The script's resolved name.
 * @param issues - Optional sink the mismatch is reported to.
 * @returns The resolved icon name.
 */
function readRunScriptIcon(
	record: Record<string, unknown>,
	script: string,
	issues?: RunScriptIssue[],
): RunScriptIconName {
	const value = record.icon;

	if (isRunScriptIconName(value)) {
		return value;
	}

	if (value !== undefined) {
		issues?.push({
			expected: 'one of the supported icon names',
			field: 'icon',
			kind: 'invalid',
			script,
		});
	}

	return DEFAULT_RUN_SCRIPT_ICON;
}

/**
 * Reads a script's default flag under either spelling, treating a mistyped
 * value as false.
 * @param record - Candidate record.
 * @param script - The script's resolved name.
 * @param issues - Optional sink the mismatch is reported to.
 * @returns Whether the script is the repository's default.
 */
function readRunScriptDefault(
	record: Record<string, unknown>,
	script: string,
	issues?: RunScriptIssue[],
): boolean {
	const field = 'default' in record ? 'default' : 'isDefault';
	const value = record[field];

	if (value === undefined || typeof value === 'boolean') {
		return value === true;
	}

	issues?.push({ expected: 'boolean', field, kind: 'invalid', script });

	return false;
}

/**
 * Reads a script's environments list under either spelling, treating a mistyped
 * value as undeclared.
 * @param record - Candidate record.
 * @param script - The script's resolved name.
 * @param issues - Optional sink the mismatch is reported to.
 * @returns The declared environments, or null.
 */
function readRunScriptAvailability(
	record: Record<string, unknown>,
	script: string,
	issues?: RunScriptIssue[],
): readonly string[] | null {
	const field = 'available_in' in record ? 'available_in' : 'availableIn';
	const value = record[field];

	if (value === undefined || value === null) {
		return null;
	}

	if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
		return [...value];
	}

	issues?.push({
		expected: 'array of strings',
		field,
		kind: 'invalid',
		script,
	});

	return null;
}

/**
 * Narrows a candidate to a plain record, rejecting arrays and null.
 * @param value - Candidate value.
 * @returns The record, or null.
 */
function asRunScriptRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/**
 * Reads a trimmed non-empty string from an unknown value.
 * @param value - Candidate value.
 * @returns The trimmed string, or null.
 */
function trimmedString(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const trimmed = value.trim();

	return trimmed || null;
}
