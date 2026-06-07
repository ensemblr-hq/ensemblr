import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { load } from 'js-toml';

import type {
	ConfigDiagnostic,
	RepositoryConfigMigrationPreview,
	RepositoryConfigMigrationRequest,
	RepositoryConfigMigrationResult,
	RepositoryConfigSnapshot,
	RepositoryConfigSourceSnapshot,
	RepositoryConfigSourceStatus,
	SettingsResolutionSource,
} from '../../shared/ipc';
import {
	applyRepositoryConfigMigration,
	normalizeRepositoryConfigRequest,
	previewRepositoryConfigMigration,
} from './repository-config-migration.ts';

/** Options for {@link loadRepositoryConfig}. */
export interface LoadRepositoryConfigOptions {
	now?: () => Date;
	repositoryPath: string;
}

/** Aggregated result of loading every supported repository config source. */
export interface LoadedRepositoryConfig {
	conductorLegacyConfig?: Record<string, unknown>;
	conductorLocalConfig?: Record<string, unknown>;
	conductorSharedConfig?: Record<string, unknown>;
	ensembleConfig?: Record<string, unknown>;
	snapshot: RepositoryConfigSnapshot;
	worktreeincludeConfig?: Record<string, unknown>;
}

/** Service exposed to IPC handlers for inspecting and migrating repo config. */
export interface RepositoryConfigService {
	applyMigration: (
		request: RepositoryConfigMigrationRequest,
	) => RepositoryConfigMigrationResult;
	load: (request: unknown) => RepositoryConfigSnapshot;
	previewMigration: (
		request: RepositoryConfigMigrationRequest,
	) => RepositoryConfigMigrationPreview;
}

export type { RepositoryConfigPathAuthorizationOptions } from './repository-config-auth.ts';
export { isRepositoryConfigPathAllowed } from './repository-config-auth.ts';

/** Internal: result of reading a single config file from disk. */
interface ParsedConfigSource {
	diagnostics: ConfigDiagnostic[];
	path: string;
	record: Record<string, unknown> | null;
	status: RepositoryConfigSourceStatus;
}

/** Internal: result of normalising a parsed config file. */
interface NormalizedConfigSource {
	diagnostics: ConfigDiagnostic[];
	settings: Record<string, unknown>;
}

export const ENSEMBLE_CONFIG_FILENAME = 'ensemble.json';
const LEGACY_CONDUCTOR_CONFIG_FILENAME = 'conductor.json';
const CONDUCTOR_DIRECTORY = '.conductor';
const CONDUCTOR_SHARED_SETTINGS_FILENAME = 'settings.toml';
const CONDUCTOR_LOCAL_SETTINGS_FILENAME = 'settings.local.toml';
const WORKTREE_INCLUDE_FILENAME = '.worktreeinclude';

const SCRIPT_FIELD_MAP = new Map([
	['archive', 'archive'],
	['run', 'run'],
	['setup', 'setup'],
] as const);

const TOML_FIELD_MAP: ReadonlyMap<string, string> = new Map([
	['enterprise_data_privacy', 'enterpriseDataPrivacy'],
	['environment_variables', 'environmentVariables'],
	['file_include_globs', 'filesToCopy'],
	['git', 'git'],
	['prompts', 'prompts'],
	['spotlight_testing', 'spotlightTesting'],
	['claude_executable_path', 'claudeExecutablePath'],
	['codex_executable_path', 'codexExecutablePath'],
	['gemini_executable_path', 'geminiExecutablePath'],
	['opencode_executable_path', 'opencodeExecutablePath'],
	['open_code_executable_path', 'opencodeExecutablePath'],
	['amp_executable_path', 'ampExecutablePath'],
	['copilot_executable_path', 'copilotExecutablePath'],
	['pi_executable_path', 'piExecutablePath'],
] as const);

const JSON_FIELD_MAP: ReadonlyMap<string, string> = new Map([
	['enterpriseDataPrivacy', 'enterpriseDataPrivacy'],
	['environmentVariables', 'environmentVariables'],
	['filesToCopy', 'filesToCopy'],
	['git', 'git'],
	['prompts', 'prompts'],
	['runScriptMode', 'runScriptMode'],
	['spotlightTesting', 'spotlightTesting'],
	['claudeExecutablePath', 'claudeExecutablePath'],
	['codexExecutablePath', 'codexExecutablePath'],
	['geminiExecutablePath', 'geminiExecutablePath'],
	['opencodeExecutablePath', 'opencodeExecutablePath'],
	['ampExecutablePath', 'ampExecutablePath'],
	['copilotExecutablePath', 'copilotExecutablePath'],
	['piExecutablePath', 'piExecutablePath'],
] as const);

const OBJECT_SETTING_KEYS = new Set([
	'environmentVariables',
	'git',
	'prompts',
	'spotlightTesting',
]);

const STRING_SETTING_KEYS = new Set([
	'ampExecutablePath',
	'claudeExecutablePath',
	'codexExecutablePath',
	'copilotExecutablePath',
	'geminiExecutablePath',
	'opencodeExecutablePath',
	'piExecutablePath',
	'runScriptMode',
]);

/**
 * Builds the {@link RepositoryConfigService} used by IPC handlers to load and
 * migrate per-repository configuration files.
 * @returns A fresh service instance with no internal state.
 */
export function createRepositoryConfigService(): RepositoryConfigService {
	return {
		applyMigration: (request) => applyRepositoryConfigMigration(request),
		load: (request) =>
			loadRepositoryConfig(normalizeRepositoryConfigRequest(request)).snapshot,
		previewMigration: (request) => previewRepositoryConfigMigration(request),
	};
}

export {
	applyRepositoryConfigMigration,
	normalizeRepositoryConfigRequest,
	previewRepositoryConfigMigration,
} from './repository-config-migration.ts';

/**
 * Loads every supported repository config source (ensemble.json, conductor
 * shared/local TOML, legacy conductor.json, .worktreeinclude), normalises each,
 * and returns both raw parsed records and an IPC-safe snapshot.
 * @param options - Repository path and optional clock.
 * @returns The parsed config sources plus a transport snapshot.
 */
export function loadRepositoryConfig({
	now = () => new Date(),
	repositoryPath,
}: LoadRepositoryConfigOptions): LoadedRepositoryConfig {
	if (!repositoryPath.trim()) {
		return {
			snapshot: {
				diagnostics: [
					{
						code: 'repository-path-missing',
						message: 'No repository path was provided.',
						severity: 'error',
					},
				],
				loadedAt: now().toISOString(),
				repositoryPath: '',
				sources: [],
			},
		};
	}

	const resolvedRepositoryPath = path.resolve(repositoryPath);
	const diagnostics: ConfigDiagnostic[] = [];
	const sources: RepositoryConfigSourceSnapshot[] = [];

	const worktreeinclude = loadWorktreeincludeSource(resolvedRepositoryPath);
	pushSourceSnapshot({
		repositoryPath: resolvedRepositoryPath,
		settings: worktreeinclude.settings,
		source: 'worktreeinclude',
		sourcePath: path.join(resolvedRepositoryPath, WORKTREE_INCLUDE_FILENAME),
		sources,
		status: worktreeinclude.status,
	});
	diagnostics.push(...worktreeinclude.diagnostics);

	const conductorLocal = loadTomlSource({
		repositoryPath: resolvedRepositoryPath,
		source: 'conductor-local-config',
		sourcePath: path.join(
			resolvedRepositoryPath,
			CONDUCTOR_DIRECTORY,
			CONDUCTOR_LOCAL_SETTINGS_FILENAME,
		),
	});
	sources.push(conductorLocal.snapshot);
	diagnostics.push(...conductorLocal.diagnostics);

	const ensemble = loadJsonSource({
		kind: 'ensemble',
		repositoryPath: resolvedRepositoryPath,
		source: 'ensemble-config',
		sourcePath: path.join(resolvedRepositoryPath, ENSEMBLE_CONFIG_FILENAME),
	});
	sources.push(ensemble.snapshot);
	diagnostics.push(...ensemble.diagnostics);

	const conductorShared = loadTomlSource({
		repositoryPath: resolvedRepositoryPath,
		source: 'conductor-config',
		sourcePath: path.join(
			resolvedRepositoryPath,
			CONDUCTOR_DIRECTORY,
			CONDUCTOR_SHARED_SETTINGS_FILENAME,
		),
	});
	sources.push(conductorShared.snapshot);
	diagnostics.push(...conductorShared.diagnostics);

	const legacyPath = path.join(
		resolvedRepositoryPath,
		LEGACY_CONDUCTOR_CONFIG_FILENAME,
	);
	let conductorLegacySettings: Record<string, unknown> | undefined;

	if (
		conductorShared.snapshot.status === 'loaded' ||
		conductorShared.snapshot.status === 'invalid'
	) {
		const ignoredLegacyStatus = existsSync(legacyPath) ? 'ignored' : 'missing';
		pushSourceSnapshot({
			repositoryPath: resolvedRepositoryPath,
			settings: {},
			source: 'conductor-legacy-config',
			sourcePath: legacyPath,
			sources,
			status: ignoredLegacyStatus,
		});

		if (ignoredLegacyStatus === 'ignored') {
			diagnostics.push({
				code: 'legacy-conductor-json-ignored',
				fieldPath: '$',
				message:
					'Legacy conductor.json was ignored because .conductor/settings.toml is present.',
				severity: 'info',
			});
		}
	} else {
		const conductorLegacy = loadJsonSource({
			kind: 'conductor',
			repositoryPath: resolvedRepositoryPath,
			source: 'conductor-legacy-config',
			sourcePath: legacyPath,
		});
		sources.push(conductorLegacy.snapshot);
		diagnostics.push(...conductorLegacy.diagnostics);
		conductorLegacySettings = getLoadedSettings(conductorLegacy.snapshot);
	}

	return {
		conductorLegacyConfig: conductorLegacySettings,
		conductorLocalConfig: getLoadedSettings(conductorLocal.snapshot),
		conductorSharedConfig: getLoadedSettings(conductorShared.snapshot),
		ensembleConfig: getLoadedSettings(ensemble.snapshot),
		snapshot: {
			diagnostics,
			loadedAt: now().toISOString(),
			repositoryPath: resolvedRepositoryPath,
			sources,
		},
		worktreeincludeConfig: getLoadedSettingsForStatus(
			worktreeinclude.settings,
			worktreeinclude.status,
		),
	};
}

/**
 * Reads and normalises a JSON repository config file.
 * @param input - Parsing context (kind, source identifier, path).
 * @returns Diagnostics plus the snapshot describing the source.
 */
function loadJsonSource({
	kind,
	repositoryPath,
	source,
	sourcePath,
}: {
	kind: 'conductor' | 'ensemble';
	repositoryPath: string;
	source: SettingsResolutionSource;
	sourcePath: string;
}): {
	diagnostics: ConfigDiagnostic[];
	snapshot: RepositoryConfigSourceSnapshot;
} {
	const parsed = readJsonFile({ kind, source, sourcePath });
	const normalized = parsed.record
		? normalizeJsonRepositoryConfig({
				config: parsed.record,
				kind,
				source,
			})
		: { diagnostics: [], settings: {} };

	return {
		diagnostics: [...parsed.diagnostics, ...normalized.diagnostics],
		snapshot: createSourceSnapshot({
			repositoryPath,
			settings: normalized.settings,
			source,
			sourcePath,
			status: parsed.status,
		}),
	};
}

/**
 * Reads and normalises a TOML repository config file.
 * @param input - Source identifier and path.
 * @returns Diagnostics plus the snapshot describing the source.
 */
function loadTomlSource({
	repositoryPath,
	source,
	sourcePath,
}: {
	repositoryPath: string;
	source: SettingsResolutionSource;
	sourcePath: string;
}): {
	diagnostics: ConfigDiagnostic[];
	snapshot: RepositoryConfigSourceSnapshot;
} {
	const parsed = readTomlFile({ sourcePath });
	const normalized = parsed.record
		? normalizeTomlRepositoryConfig(parsed.record, source)
		: { diagnostics: [], settings: {} };

	return {
		diagnostics: [...parsed.diagnostics, ...normalized.diagnostics],
		snapshot: createSourceSnapshot({
			repositoryPath,
			settings: normalized.settings,
			source,
			sourcePath,
			status: parsed.status,
		}),
	};
}

/**
 * Parses a `.worktreeinclude` file (one path per line) into a `filesToCopy`
 * setting, skipping blanks and `#`-prefixed comments.
 * @param repositoryPath - Repository root.
 * @returns Diagnostics, derived settings, and source status.
 */
function loadWorktreeincludeSource(repositoryPath: string): {
	diagnostics: ConfigDiagnostic[];
	settings: Record<string, unknown>;
	status: RepositoryConfigSourceStatus;
} {
	const sourcePath = path.join(repositoryPath, WORKTREE_INCLUDE_FILENAME);

	if (!existsSync(sourcePath)) {
		return { diagnostics: [], settings: {}, status: 'missing' };
	}

	let source: string;

	try {
		source = readFileSync(sourcePath, 'utf8');
	} catch (error) {
		return {
			diagnostics: [
				{
					code: 'repository-config-read-error',
					message: formatErrorMessage(
						error,
						'Failed to read .worktreeinclude.',
					),
					severity: 'error',
				},
			],
			settings: {},
			status: 'invalid',
		};
	}

	const filesToCopy = source
		.split(/\r?\n/)
		.map((line) => line.trim())
		.flatMap((line) => {
			if (!line || line.startsWith('#')) {
				return [];
			}

			return [line.startsWith('\\#') ? line.slice(1) : line];
		});

	return {
		diagnostics: [],
		settings: { filesToCopy },
		status: 'loaded',
	};
}

/**
 * Reads a JSON file from disk and reports parse/IO errors as diagnostics.
 * @param input - File kind and path.
 * @returns The parsed record (or `null`) plus status diagnostics.
 */
export function readJsonFile({
	kind,
	source,
	sourcePath,
}: {
	kind: 'conductor' | 'ensemble';
	source: SettingsResolutionSource;
	sourcePath: string;
}): ParsedConfigSource {
	if (!existsSync(sourcePath)) {
		return {
			diagnostics: [],
			path: sourcePath,
			record: null,
			status: 'missing',
		};
	}

	let rawSource: string;

	try {
		rawSource = readFileSync(sourcePath, 'utf8');
	} catch (error) {
		return {
			diagnostics: [
				{
					code: 'repository-config-read-error',
					message: formatErrorMessage(error, 'Failed to read config file.'),
					severity: 'error',
				},
			],
			path: sourcePath,
			record: null,
			status: 'invalid',
		};
	}

	try {
		const parsed = JSON.parse(rawSource);

		if (!isPlainRecord(parsed)) {
			return {
				diagnostics: [
					{
						code: 'invalid-repository-config-root',
						fieldPath: '$',
						message: `${formatSourceName(source)} root must be a JSON object.`,
						severity: 'error',
					},
				],
				path: sourcePath,
				record: null,
				status: 'invalid',
			};
		}

		return {
			diagnostics: [],
			path: sourcePath,
			record: parsed,
			status: 'loaded',
		};
	} catch (error) {
		return {
			diagnostics: [
				{
					...getJsonErrorLocation(rawSource, error),
					code: 'invalid-repository-json',
					message: formatErrorMessage(
						error,
						`${kind === 'ensemble' ? 'ensemble.json' : 'conductor.json'} is not valid JSON.`,
					),
					severity: 'error',
				},
			],
			path: sourcePath,
			record: null,
			status: 'invalid',
		};
	}
}

/**
 * Reads a TOML file from disk and reports parse/IO errors as diagnostics.
 * @param input - File path.
 * @returns The parsed record (or `null`) plus status diagnostics.
 */
function readTomlFile({
	sourcePath,
}: {
	sourcePath: string;
}): ParsedConfigSource {
	if (!existsSync(sourcePath)) {
		return {
			diagnostics: [],
			path: sourcePath,
			record: null,
			status: 'missing',
		};
	}

	let rawSource: string;

	try {
		rawSource = readFileSync(sourcePath, 'utf8');
	} catch (error) {
		return {
			diagnostics: [
				{
					code: 'repository-config-read-error',
					message: formatErrorMessage(
						error,
						'Failed to read TOML config file.',
					),
					severity: 'error',
				},
			],
			path: sourcePath,
			record: null,
			status: 'invalid',
		};
	}

	try {
		return {
			diagnostics: [],
			path: sourcePath,
			record: load(rawSource),
			status: 'loaded',
		};
	} catch (error) {
		return {
			diagnostics: [
				{
					code: 'invalid-repository-toml',
					message: formatErrorMessage(
						error,
						'Conductor TOML settings are not valid TOML.',
					),
					severity: 'error',
				},
			],
			path: sourcePath,
			record: null,
			status: 'invalid',
		};
	}
}

/**
 * Maps a parsed JSON config record onto the canonical Ensemble setting keys,
 * collecting per-field diagnostics for unsupported or wrongly-typed values.
 * @param input - Parsed record plus kind and source labels.
 * @returns Normalised settings and diagnostics.
 */
function normalizeJsonRepositoryConfig({
	config,
	kind,
	source,
}: {
	config: Record<string, unknown>;
	kind: 'conductor' | 'ensemble';
	source: SettingsResolutionSource;
}): NormalizedConfigSource {
	const diagnostics: ConfigDiagnostic[] = [];
	const settings: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(config)) {
		if (key === 'scripts') {
			mergeSettings(
				settings,
				normalizeScripts(value, '$.scripts', source, false),
			);
			continue;
		}

		const normalizedKey = JSON_FIELD_MAP.get(key);

		if (!normalizedKey) {
			diagnostics.push(
				createUnsupportedFieldDiagnostic(key, source, `$.${key}`),
			);
			continue;
		}

		const normalizedValue = normalizeSettingValue({
			fieldPath: `$.${key}`,
			key: normalizedKey,
			source,
			value,
		});

		if (normalizedValue.accepted) {
			settings[normalizedKey] = normalizedValue.value;
			continue;
		}

		diagnostics.push(normalizedValue.diagnostic);
	}

	if (kind === 'conductor' && Object.keys(settings).length > 0) {
		settings.conductorCompatibility ??= true;
	}

	diagnostics.push(...takeNestedDiagnostics(settings));

	return { diagnostics, settings };
}

/**
 * Maps a parsed TOML config record onto the canonical Ensemble setting keys,
 * applying snake-to-camel renames and collecting per-field diagnostics.
 * @param config - Parsed TOML record.
 * @param source - Source identifier used in diagnostics.
 * @returns Normalised settings and diagnostics.
 */
function normalizeTomlRepositoryConfig(
	config: Record<string, unknown>,
	source: SettingsResolutionSource,
): NormalizedConfigSource {
	const diagnostics: ConfigDiagnostic[] = [];
	const settings: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(config)) {
		if (key === 'scripts') {
			mergeSettings(
				settings,
				normalizeScripts(value, '$.scripts', source, true),
			);
			continue;
		}

		const normalizedKey = TOML_FIELD_MAP.get(key);

		if (!normalizedKey) {
			diagnostics.push(
				createUnsupportedFieldDiagnostic(key, source, `$.${key}`),
			);
			continue;
		}

		const normalizedValue = normalizeSettingValue({
			fieldPath: `$.${key}`,
			key: normalizedKey,
			source,
			value,
		});

		if (normalizedValue.accepted) {
			settings[normalizedKey] = normalizedValue.value;
			continue;
		}

		diagnostics.push(normalizedValue.diagnostic);
	}

	if (Object.keys(settings).length > 0) {
		settings.conductorCompatibility ??= true;
	}

	diagnostics.push(...takeNestedDiagnostics(settings));

	return { diagnostics, settings };
}

/**
 * Normalises the `scripts` block (setup/run/archive plus optional `run_mode`),
 * collecting diagnostics for unsupported keys and non-string values.
 * @param value - Raw `scripts` value to normalise.
 * @param fieldPath - JSONPath used in diagnostic messages.
 * @param source - Source identifier used in diagnostics.
 * @param supportRunMode - Whether to accept the TOML-only `run_mode` key.
 * @returns Partial settings record (may include the special `__diagnostics` key).
 */
function normalizeScripts(
	value: unknown,
	fieldPath: string,
	source: SettingsResolutionSource,
	supportRunMode: boolean,
): Record<string, unknown> {
	if (!isPlainRecord(value)) {
		return {};
	}

	const scripts: Record<string, unknown> = {};
	const settings: Record<string, unknown> = {};

	for (const [key, scriptValue] of Object.entries(value)) {
		const normalizedScriptKey = SCRIPT_FIELD_MAP.get(
			key as 'archive' | 'run' | 'setup',
		);

		if (normalizedScriptKey) {
			if (typeof scriptValue === 'string') {
				scripts[normalizedScriptKey] = scriptValue;
			} else {
				pushNestedDiagnostic(
					settings,
					createInvalidFieldDiagnostic(
						key,
						source,
						`${fieldPath}.${key}`,
						'string',
					),
				);
			}
			continue;
		}

		if (supportRunMode && key === 'run_mode') {
			if (typeof scriptValue === 'string') {
				settings.runScriptMode = scriptValue;
			} else {
				pushNestedDiagnostic(
					settings,
					createInvalidFieldDiagnostic(
						key,
						source,
						`${fieldPath}.${key}`,
						'string',
					),
				);
			}
			continue;
		}

		pushNestedDiagnostic(
			settings,
			createUnsupportedFieldDiagnostic(key, source, `${fieldPath}.${key}`),
		);
	}

	if (Object.keys(scripts).length > 0) {
		settings.scripts = scripts;
	}

	return settings;
}

/**
 * Type-checks a single setting value against the expected shape for its key.
 * @param input - Key plus the candidate value and diagnostic context.
 * @returns Either an `accepted` value or a `diagnostic` describing the mismatch.
 */
function normalizeSettingValue({
	fieldPath,
	key,
	source,
	value,
}: {
	fieldPath: string;
	key: string;
	source: SettingsResolutionSource;
	value: unknown;
}):
	| { accepted: true; value: unknown }
	| { accepted: false; diagnostic: ConfigDiagnostic } {
	if (key === 'enterpriseDataPrivacy') {
		if (typeof value === 'boolean') {
			return { accepted: true, value };
		}

		return {
			accepted: false,
			diagnostic: createInvalidFieldDiagnostic(
				key,
				source,
				fieldPath,
				'boolean',
			),
		};
	}

	if (key === 'filesToCopy') {
		if (isStringArray(value)) {
			return { accepted: true, value };
		}

		return {
			accepted: false,
			diagnostic: createInvalidFieldDiagnostic(
				key,
				source,
				fieldPath,
				'array of strings',
			),
		};
	}

	if (OBJECT_SETTING_KEYS.has(key)) {
		if (isPlainRecord(value)) {
			return { accepted: true, value: cloneRecord(value) };
		}

		return {
			accepted: false,
			diagnostic: createInvalidFieldDiagnostic(
				key,
				source,
				fieldPath,
				'object',
			),
		};
	}

	if (STRING_SETTING_KEYS.has(key)) {
		if (typeof value === 'string') {
			return { accepted: true, value };
		}

		return {
			accepted: false,
			diagnostic: createInvalidFieldDiagnostic(
				key,
				source,
				fieldPath,
				'string',
			),
		};
	}

	return { accepted: true, value };
}

/**
 * Builds the IPC-safe snapshot describing a single config source, stripping the
 * internal `__diagnostics` carrier and clearing settings when not `loaded`.
 * @param input - Source identifier, status, path and settings.
 * @returns A snapshot for transport across IPC.
 */
function createSourceSnapshot({
	repositoryPath,
	settings,
	source,
	sourcePath,
	status,
}: {
	repositoryPath: string;
	settings: Record<string, unknown>;
	source: SettingsResolutionSource;
	sourcePath: string;
	status: RepositoryConfigSourceStatus;
}): RepositoryConfigSourceSnapshot {
	const cleanSettings = { ...settings };
	delete cleanSettings.__diagnostics;

	return {
		displayPath: formatRepositoryDisplayPath(sourcePath, repositoryPath),
		path: sourcePath,
		settings: status === 'loaded' ? cleanSettings : {},
		source,
		status,
	};
}

/**
 * Appends a freshly-built source snapshot to the in-progress `sources` list.
 * @param input - Source identifier and snapshot fields plus the target list.
 */
function pushSourceSnapshot({
	repositoryPath,
	settings,
	source,
	sourcePath,
	sources,
	status,
}: {
	repositoryPath: string;
	settings: Record<string, unknown>;
	source: SettingsResolutionSource;
	sourcePath: string;
	sources: RepositoryConfigSourceSnapshot[];
	status: RepositoryConfigSourceStatus;
}): void {
	sources.push(
		createSourceSnapshot({
			repositoryPath,
			settings,
			source,
			sourcePath,
			status,
		}),
	);
}

/**
 * Returns the snapshot's settings only when its status is `loaded`.
 * @param snapshot - Source snapshot.
 * @returns The settings, or `undefined`.
 */
function getLoadedSettings(
	snapshot: RepositoryConfigSourceSnapshot,
): Record<string, unknown> | undefined {
	return getLoadedSettingsForStatus(snapshot.settings, snapshot.status);
}

/**
 * Status-gated accessor used by sources that don't have a snapshot yet.
 * @param settings - Candidate settings record.
 * @param status - Source status.
 * @returns The settings when status is `loaded`, otherwise `undefined`.
 */
function getLoadedSettingsForStatus(
	settings: Record<string, unknown>,
	status: RepositoryConfigSourceStatus,
): Record<string, unknown> | undefined {
	if (status !== 'loaded') {
		return undefined;
	}

	return settings;
}

/**
 * Merges `source` into `target` in place, preserving and concatenating the
 * internal `__diagnostics` carrier and deep-merging `scripts`.
 * @param target - Settings record to update.
 * @param source - Partial settings to merge in.
 */
function mergeSettings(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): void {
	const diagnostics = source.__diagnostics;

	if (Array.isArray(diagnostics)) {
		target.__diagnostics = [
			...((target.__diagnostics as ConfigDiagnostic[] | undefined) ?? []),
			...diagnostics,
		];
		delete source.__diagnostics;
	}

	for (const [key, value] of Object.entries(source)) {
		if (
			key === 'scripts' &&
			isPlainRecord(value) &&
			isPlainRecord(target.scripts)
		) {
			target.scripts = { ...target.scripts, ...value };
			continue;
		}

		target[key] = value;
	}
}

/**
 * Attaches a diagnostic to a settings record via the internal `__diagnostics`
 * carrier so it can be hoisted later by {@link takeNestedDiagnostics}.
 * @param settings - Settings record being normalised.
 * @param diagnostic - Diagnostic to append.
 */
function pushNestedDiagnostic(
	settings: Record<string, unknown>,
	diagnostic: ConfigDiagnostic,
): void {
	settings.__diagnostics = [
		...((settings.__diagnostics as ConfigDiagnostic[] | undefined) ?? []),
		diagnostic,
	];
}

/**
 * Extracts and removes accumulated nested diagnostics from a settings record.
 * @param settings - Settings record to drain.
 * @returns The previously-collected diagnostics.
 */
function takeNestedDiagnostics(
	settings: Record<string, unknown>,
): ConfigDiagnostic[] {
	const diagnostics = settings.__diagnostics;
	delete settings.__diagnostics;

	return Array.isArray(diagnostics) ? diagnostics : [];
}

/**
 * Returns a structurally-cloned copy of a JSON-safe record.
 * @param record - Record to clone.
 * @returns A deep clone of `record`.
 */
export function cloneRecord(
	record: Record<string, unknown>,
): Record<string, unknown> {
	return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}

/**
 * Compares two JSON-safe values for structural equality.
 * @param left - First value.
 * @param right - Second value.
 * @returns True when their JSON serialisations match.
 */
export function areJsonValuesEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Builds an "unsupported field" warning diagnostic.
 * @param key - Field key.
 * @param source - Source identifier.
 * @param fieldPath - JSONPath for the field.
 * @returns A warning diagnostic.
 */
function createUnsupportedFieldDiagnostic(
	key: string,
	source: SettingsResolutionSource,
	fieldPath: string,
): ConfigDiagnostic {
	return {
		code: 'unsupported-repository-config-field',
		fieldPath,
		message: `${formatSourceName(source)} field "${key}" is not supported and was ignored.`,
		severity: 'warning',
	};
}

/**
 * Builds an "invalid field type" warning diagnostic.
 * @param key - Field key.
 * @param source - Source identifier.
 * @param fieldPath - JSONPath for the field.
 * @param expected - Human-readable expected type.
 * @returns A warning diagnostic.
 */
function createInvalidFieldDiagnostic(
	key: string,
	source: SettingsResolutionSource,
	fieldPath: string,
	expected: string,
): ConfigDiagnostic {
	return {
		code: 'invalid-repository-config-field',
		fieldPath,
		message: `${formatSourceName(source)} field "${key}" must be ${expected}.`,
		severity: 'warning',
	};
}

/**
 * Maps a settings source identifier to its on-disk filename for diagnostics.
 * @param source - Source identifier.
 * @returns Human-readable file name.
 */
function formatSourceName(source: SettingsResolutionSource): string {
	if (source === 'conductor-config') {
		return '.conductor/settings.toml';
	}

	if (source === 'conductor-local-config') {
		return '.conductor/settings.local.toml';
	}

	if (source === 'conductor-legacy-config') {
		return 'conductor.json';
	}

	if (source === 'ensemble-config') {
		return 'ensemble.json';
	}

	if (source === 'worktreeinclude') {
		return '.worktreeinclude';
	}

	return source;
}

/**
 * Renders a source path relative to the repository root when possible.
 * @param sourcePath - Absolute source path.
 * @param repositoryPath - Repository root.
 * @returns Relative path, or `sourcePath` when it lives outside the repo.
 */
function formatRepositoryDisplayPath(
	sourcePath: string,
	repositoryPath: string,
): string {
	const relativePath = path.relative(repositoryPath, sourcePath);

	if (!relativePath || relativePath.startsWith('..')) {
		return sourcePath;
	}

	return relativePath;
}

/**
 * Extracts a line/column hint from a JSON parser error message.
 * @param source - Raw JSON source text.
 * @param error - The parser error thrown by `JSON.parse`.
 * @returns A partial diagnostic with `line` and `column`, when available.
 */
function getJsonErrorLocation(
	source: string,
	error: unknown,
): Pick<ConfigDiagnostic, 'column' | 'line'> {
	const message = error instanceof Error ? error.message : '';
	const positionMatch = /position (\d+)/i.exec(message);

	if (positionMatch) {
		const position = Number(positionMatch[1]);
		const beforePosition = source.slice(0, Math.max(0, position));
		const lines = beforePosition.split('\n');

		return {
			column: (lines.at(-1)?.length ?? 0) + 1,
			line: lines.length,
		};
	}

	return {};
}

/**
 * Coerces an unknown thrown value to a user-facing message.
 * @param error - Thrown value.
 * @param fallback - Fallback message when `error` is not an `Error`.
 * @returns A human-readable message.
 */
export function formatErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

/**
 * Type guard for an array of strings.
 * @param value - Candidate value.
 * @returns True when every element is a string.
 */
function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === 'string')
	);
}

/**
 * Type guard that excludes arrays from the structural-record check.
 * @param value - Candidate value.
 * @returns True when `value` is a non-null, non-array object.
 */
export function isPlainRecord(
	value: unknown,
): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
