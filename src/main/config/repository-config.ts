import { existsSync } from 'node:fs';
import path from 'node:path';

import type { ConfigDiagnostic } from '../../shared/ipc/contracts/health';
import type {
	RepositoryConfigSnapshot,
	RepositoryConfigSourceSnapshot,
	RepositoryConfigSourceStatus,
} from '../../shared/ipc/contracts/repository-config';
import type { SettingsResolutionSource } from '../../shared/ipc/contracts/settings-resolution';
import { cloneRecord, isPlainRecord } from './json-utils.ts';
import {
	formatSourceName,
	loadWorktreeincludeSource,
	readJsonFile,
	readTomlFile,
	WORKTREE_INCLUDE_FILENAME,
} from './repository-config-loaders.ts';

export { readJsonFile } from './repository-config-loaders.ts';

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
	const { diagnostics, settings } = normalizeRepositoryConfigFields({
		config,
		fieldMap: JSON_FIELD_MAP,
		scriptSupportsRunMode: false,
		source,
	});

	const withCompatFlag =
		kind === 'conductor' && Object.keys(settings).length > 0
			? { conductorCompatibility: true, ...settings }
			: settings;

	return { diagnostics, settings: withCompatFlag };
}

/**
 * Shared per-field normalisation loop used by both JSON and TOML parsers.
 * Handles the special `scripts` key, looks up the field map for the
 * canonical key, and returns the accumulated settings plus diagnostics.
 */
function normalizeRepositoryConfigFields({
	config,
	fieldMap,
	scriptSupportsRunMode,
	source,
}: {
	config: Record<string, unknown>;
	fieldMap: ReadonlyMap<string, string>;
	scriptSupportsRunMode: boolean;
	source: SettingsResolutionSource;
}): { diagnostics: ConfigDiagnostic[]; settings: Record<string, unknown> } {
	const diagnostics: ConfigDiagnostic[] = [];
	let settings: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(config)) {
		if (key === 'scripts') {
			const normalizedScripts = normalizeScripts(
				value,
				'$.scripts',
				source,
				scriptSupportsRunMode,
			);
			settings = mergeSettings(settings, normalizedScripts.settings);
			diagnostics.push(...normalizedScripts.diagnostics);
			continue;
		}

		const normalizedKey = fieldMap.get(key);

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
			settings = { ...settings, [normalizedKey]: normalizedValue.value };
			continue;
		}

		diagnostics.push(normalizedValue.diagnostic);
	}

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
	const { diagnostics, settings } = normalizeRepositoryConfigFields({
		config,
		fieldMap: TOML_FIELD_MAP,
		scriptSupportsRunMode: true,
		source,
	});

	const withCompatFlag =
		Object.keys(settings).length > 0
			? { conductorCompatibility: true, ...settings }
			: settings;

	return { diagnostics, settings: withCompatFlag };
}

/**
 * Normalises the `scripts` block (setup/run/archive plus optional `run_mode`),
 * collecting diagnostics for unsupported keys and non-string values.
 * @param value - Raw `scripts` value to normalise.
 * @param fieldPath - JSONPath used in diagnostic messages.
 * @param source - Source identifier used in diagnostics.
 * @param supportRunMode - Whether to accept the TOML-only `run_mode` key.
 * @returns Partial settings record plus accumulated diagnostics.
 */
function normalizeScripts(
	value: unknown,
	fieldPath: string,
	source: SettingsResolutionSource,
	supportRunMode: boolean,
): NormalizedConfigSource {
	if (!isPlainRecord(value)) {
		return { diagnostics: [], settings: {} };
	}

	const diagnostics: ConfigDiagnostic[] = [];
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
				diagnostics.push(
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
				diagnostics.push(
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

		diagnostics.push(
			createUnsupportedFieldDiagnostic(key, source, `${fieldPath}.${key}`),
		);
	}

	if (Object.keys(scripts).length > 0) {
		settings.scripts = scripts;
	}

	return { diagnostics, settings };
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
 * Builds the IPC-safe snapshot describing a single config source, clearing
 * settings when the source did not load.
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
	return {
		displayPath: formatRepositoryDisplayPath(sourcePath, repositoryPath),
		path: sourcePath,
		settings: status === 'loaded' ? { ...settings } : {},
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
 * Returns a new settings record with `source` merged on top of `target`,
 * deep-merging the `scripts` block when both sides provide one.
 */
function mergeSettings(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> {
	const mergedScripts =
		isPlainRecord(source.scripts) && isPlainRecord(target.scripts)
			? { ...target.scripts, ...source.scripts }
			: undefined;

	const merged = { ...target, ...source };

	if (mergedScripts !== undefined) {
		merged.scripts = mergedScripts;
	}

	return merged;
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
 * Type guard for an array of strings.
 * @param value - Candidate value.
 * @returns True when every element is a string.
 */
function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === 'string')
	);
}
