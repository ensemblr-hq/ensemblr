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
	ensemblrConfig?: Record<string, unknown>;
	snapshot: RepositoryConfigSnapshot;
	worktreeincludeConfig?: Record<string, unknown>;
}

/** Internal: result of normalising a parsed config file. */
interface NormalizedConfigSource {
	diagnostics: ConfigDiagnostic[];
	settings: Record<string, unknown>;
}

/** Directory that holds the committed repository config. */
export const ENSEMBLR_DIRECTORY = '.ensemblr';
/** Filename of the sole on-disk repository config, inside {@link ENSEMBLR_DIRECTORY}. */
export const ENSEMBLR_SETTINGS_FILENAME = 'settings.toml';

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

/**
 * Nested `[git]` TOML keys mapped onto the canonical top-level resolver keys the
 * runtime reads, with the expected value type. Without this the `[git]` block
 * flattens to `git.branch_from` etc., which no resolver key matches.
 */
const GIT_FIELD_MAP: ReadonlyMap<
	string,
	{ key: string; type: 'boolean' | 'string' }
> = new Map([
	['branch_from', { key: 'branchFrom', type: 'string' }],
	['branch_prefix', { key: 'branchPrefix', type: 'string' }],
	// Historically the branch prefix was the one camelCase `[git]` key; accept it
	// so existing committed configs keep resolving after normalization.
	['branchPrefix', { key: 'branchPrefix', type: 'string' }],
	['remote_origin', { key: 'remoteOrigin', type: 'string' }],
	[
		'delete_local_branch_on_archive',
		{ key: 'deleteLocalBranchOnArchive', type: 'boolean' },
	],
	['archive_after_merge', { key: 'archiveAfterMerge', type: 'boolean' }],
	['set_upstream_on_push', { key: 'setUpstreamOnPush', type: 'boolean' }],
]);

/**
 * `[prompts]` TOML sub-keys mapped onto the canonical
 * `actionPreferences.<RepoActionKey>` keys the runtime action runner reads.
 * Accepts both snake_case and the historical piActions camelCase spellings so
 * existing committed configs keep resolving. Without this the `[prompts]` block
 * flattens to `prompts.*`, which no runtime consumer reads.
 */
const PROMPT_FIELD_MAP: ReadonlyMap<string, string> = new Map([
	['review', 'codeReview'],
	['code_review', 'codeReview'],
	['codeReview', 'codeReview'],
	['create_pr', 'createPr'],
	['createPr', 'createPr'],
	['fix_check_errors', 'fixErrors'],
	['fixCheckErrors', 'fixErrors'],
	['fix_errors', 'fixErrors'],
	['fixErrors', 'fixErrors'],
	['resolve_conflicts', 'resolveConflicts'],
	['resolveConflicts', 'resolveConflicts'],
	['branch_naming', 'branchRename'],
	['branchNaming', 'branchRename'],
	['branch_rename', 'branchRename'],
	['branchRename', 'branchRename'],
	['general', 'general'],
]);

const OBJECT_SETTING_KEYS = new Set([
	'environmentVariables',
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
 * Loads every supported repository config source (`.ensemblr/settings.toml` and
 * `.worktreeinclude`), normalises each, and returns both raw parsed records and
 * an IPC-safe snapshot. `.ensemblr/settings.toml` is the sole committed config;
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

	const ensemblr = loadTomlSource({
		repositoryPath: resolvedRepositoryPath,
		source: 'ensemblr-config',
		sourcePath: path.join(
			resolvedRepositoryPath,
			ENSEMBLR_DIRECTORY,
			ENSEMBLR_SETTINGS_FILENAME,
		),
	});
	sources.push(ensemblr.snapshot);
	diagnostics.push(...ensemblr.diagnostics);

	return {
		ensemblrConfig: getLoadedSettings(ensemblr.snapshot),
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
 * Maps a parsed TOML config record onto the canonical Ensemblr setting keys,
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

		if (key === 'git') {
			const normalizedGit = normalizeGitBlock(value, '$.git', source);
			settings = mergeSettings(settings, normalizedGit.settings);
			diagnostics.push(...normalizedGit.diagnostics);
			continue;
		}

		if (key === 'prompts') {
			const normalizedPrompts = normalizePromptsBlock(
				value,
				'$.prompts',
				source,
			);
			settings = mergeSettings(settings, normalizedPrompts.settings);
			diagnostics.push(...normalizedPrompts.diagnostics);
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
 * Normalises the `[git]` block, mapping each snake_case key onto its canonical
 * top-level resolver key (`branch_from` -> `branchFrom`, etc.) and type-checking
 * the value. Unsupported subkeys and mistyped values collect diagnostics.
 * @param value - Raw `git` value to normalise.
 * @param fieldPath - JSONPath used in diagnostic messages.
 * @param source - Source identifier used in diagnostics.
 * @returns Partial settings record of canonical keys plus accumulated diagnostics.
 */
function normalizeGitBlock(
	value: unknown,
	fieldPath: string,
	source: SettingsResolutionSource,
): NormalizedConfigSource {
	return normalizeMappedBlock(value, fieldPath, source, (key, entry) => {
		const mapped = GIT_FIELD_MAP.get(key);
		if (!mapped) {
			return { kind: 'unsupported' };
		}
		if (typeof entry !== mapped.type) {
			return { expected: mapped.type, kind: 'invalid' };
		}
		return { canonicalKey: mapped.key, kind: 'accepted', value: entry };
	});
}

/**
 * Normalises the `[prompts]` block, mapping each sub-key onto its canonical
 * `actionPreferences.<RepoActionKey>` key so committed shared prompts merge into
 * the same key family the runtime action runner reads.
 * @param value - Raw `prompts` value to normalise.
 * @param fieldPath - JSONPath used in diagnostic messages.
 * @param source - Source identifier used in diagnostics.
 * @returns Partial settings record of canonical keys plus accumulated diagnostics.
 */
function normalizePromptsBlock(
	value: unknown,
	fieldPath: string,
	source: SettingsResolutionSource,
): NormalizedConfigSource {
	return normalizeMappedBlock(value, fieldPath, source, (key, entry) => {
		const mapped = PROMPT_FIELD_MAP.get(key);
		if (!mapped) {
			return { kind: 'unsupported' };
		}
		if (typeof entry !== 'string') {
			return { expected: 'string', kind: 'invalid' };
		}
		return {
			canonicalKey: `actionPreferences.${mapped}`,
			kind: 'accepted',
			value: entry,
		};
	});
}

/** Outcome of resolving one sub-key of a mapped config block. */
type MappedFieldOutcome =
	| { kind: 'unsupported' }
	| { expected: string; kind: 'invalid' }
	| { canonicalKey: string; kind: 'accepted'; value: unknown };

/**
 * Shared normalisation loop for object config blocks (`[git]`, `[prompts]`)
 * whose sub-keys map onto canonical top-level keys. Delegates per-key mapping
 * and validation to `resolveField`, emitting unsupported/invalid diagnostics
 * consistently so each block only declares its own field map.
 * @param value - Raw block value to normalise.
 * @param fieldPath - JSONPath used in diagnostic messages.
 * @param source - Source identifier used in diagnostics.
 * @param resolveField - Maps and validates a single sub-key.
 * @returns Canonical settings plus accumulated diagnostics.
 */
function normalizeMappedBlock(
	value: unknown,
	fieldPath: string,
	source: SettingsResolutionSource,
	resolveField: (key: string, entry: unknown) => MappedFieldOutcome,
): NormalizedConfigSource {
	if (!isPlainRecord(value)) {
		return { diagnostics: [], settings: {} };
	}

	const diagnostics: ConfigDiagnostic[] = [];
	const settings: Record<string, unknown> = {};

	for (const [key, entry] of Object.entries(value)) {
		const outcome = resolveField(key, entry);

		if (outcome.kind === 'accepted') {
			settings[outcome.canonicalKey] = outcome.value;
			continue;
		}

		diagnostics.push(
			diagnosticForOutcome(outcome, key, source, `${fieldPath}.${key}`),
		);
	}

	return { diagnostics, settings };
}

/**
 * Builds the diagnostic for a non-accepted mapped-field outcome (unsupported key
 * or invalid value type).
 * @param outcome - The rejected outcome.
 * @param key - Sub-key that produced it.
 * @param source - Source identifier used in diagnostics.
 * @param path - JSONPath used in diagnostic messages.
 * @returns The matching diagnostic.
 */
function diagnosticForOutcome(
	outcome: { kind: 'unsupported' } | { expected: string; kind: 'invalid' },
	key: string,
	source: SettingsResolutionSource,
	path: string,
): ConfigDiagnostic {
	return outcome.kind === 'unsupported'
		? createUnsupportedFieldDiagnostic(key, source, path)
		: createInvalidFieldDiagnostic(key, source, path, outcome.expected);
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
