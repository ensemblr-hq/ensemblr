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
	readTomlFile,
	WORKTREE_INCLUDE_FILENAME,
} from './repository-config-loaders.ts';

/** Options for {@link loadRepositoryConfig}. */
export interface LoadRepositoryConfigOptions {
	now?: () => Date;
	repositoryPath: string;
}

/** Aggregated result of loading every supported repository config source. */
export interface LoadedRepositoryConfig {
	ensembleConfig?: Record<string, unknown>;
	snapshot: RepositoryConfigSnapshot;
	worktreeincludeConfig?: Record<string, unknown>;
}

/** Internal: result of normalising a parsed config file. */
interface NormalizedConfigSource {
	diagnostics: ConfigDiagnostic[];
	settings: Record<string, unknown>;
}

/** Directory that holds the committed repository config. */
export const ENSEMBLE_DIRECTORY = '.ensemble';
/** Filename of the sole on-disk repository config, inside {@link ENSEMBLE_DIRECTORY}. */
export const ENSEMBLE_SETTINGS_FILENAME = 'settings.toml';

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
 * Loads every supported repository config source (`.ensemble/settings.toml` and
 * `.worktreeinclude`), normalises each, and returns both raw parsed records and
 * an IPC-safe snapshot. `.ensemble/settings.toml` is the sole committed config;
 * `.worktreeinclude` remains a separate files-to-copy list.
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

	const ensemble = loadTomlSource({
		repositoryPath: resolvedRepositoryPath,
		source: 'ensemble-config',
		sourcePath: path.join(
			resolvedRepositoryPath,
			ENSEMBLE_DIRECTORY,
			ENSEMBLE_SETTINGS_FILENAME,
		),
	});
	sources.push(ensemble.snapshot);
	diagnostics.push(...ensemble.diagnostics);

	const legacyDiagnostic = detectLegacyConfigDiagnostic(resolvedRepositoryPath);
	if (legacyDiagnostic) {
		diagnostics.push(legacyDiagnostic);
	}

	return {
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
 * Coerces an arbitrary IPC payload into a {@link LoadRepositoryConfigOptions},
 * returning an empty path when the shape is invalid.
 * @param request - Raw IPC payload.
 * @returns Safe-to-use options.
 */
export function normalizeRepositoryConfigRequest(
	request: unknown,
): LoadRepositoryConfigOptions {
	if (
		!isPlainRecord(request) ||
		typeof request.repositoryPath !== 'string' ||
		!request.repositoryPath.trim()
	) {
		return { repositoryPath: '' };
	}

	return { repositoryPath: request.repositoryPath.trim() };
}

/**
 * Detects whether a legacy, no-longer-read repository config file
 * (`conductor.json`, `.conductor/settings.toml`, or an old-root `ensemble.json`)
 * still exists at the repository root, using an existence check only. The files
 * are never read, parsed, or migrated; this exists solely so a team repo on the
 * old format gets one informational signal instead of silently losing config.
 * @param repositoryPath - Resolved repository root.
 * @returns One `info` diagnostic when a legacy file is present, else `undefined`.
 */
function detectLegacyConfigDiagnostic(
	repositoryPath: string,
): ConfigDiagnostic | undefined {
	const legacyPaths = [
		path.join(repositoryPath, 'conductor.json'),
		path.join(repositoryPath, '.conductor', 'settings.toml'),
		path.join(repositoryPath, 'ensemble.json'),
	];

	if (!legacyPaths.some((legacyPath) => existsSync(legacyPath))) {
		return undefined;
	}

	return {
		code: 'legacy-config-ignored',
		message: `A legacy repository config file was found and ignored. Ensemble reads committed settings only from ${ENSEMBLE_DIRECTORY}/${ENSEMBLE_SETTINGS_FILENAME}; move your settings there.`,
		severity: 'info',
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
	return normalizeRepositoryConfigFields({
		config,
		fieldMap: TOML_FIELD_MAP,
		scriptSupportsRunMode: true,
		source,
	});
}

/**
 * Shared per-field normalisation loop for the TOML parser. Handles the special
 * `scripts` key, looks up the field map for the canonical key, and returns the
 * accumulated settings plus diagnostics.
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
