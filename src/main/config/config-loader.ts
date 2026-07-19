import { existsSync, type FSWatcher, readFileSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type {
	ConfigDiagnostic,
	ConfigStatus,
	ConfigStatusSnapshot,
} from '../../shared/ipc/contracts/health';
import {
	formatErrorMessage,
	getJsonErrorLocation,
	isPlainRecord,
	isSensitiveKeyName,
} from './json-utils.ts';

export type { ConfigDiagnostic, ConfigStatusSnapshot };

/** Schema version embedded in `~/.config/ensemblr/config.json`. */
export const ENSEMBLR_CONFIG_SCHEMA_VERSION = 1;

/** JSON Schema describing the supported top-level shape of the Ensemblr config. */
export const ENSEMBLR_CONFIG_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	additionalProperties: false,
	properties: {
		app: { type: 'object' },
		environment: { type: 'object' },
		managed: { type: 'object' },
		repositoryDefaults: { type: 'object' },
		repositoryRules: {
			items: { type: 'object' },
			type: 'array',
		},
		schemaVersion: { const: ENSEMBLR_CONFIG_SCHEMA_VERSION },
		security: { type: 'object' },
		ui: { type: 'object' },
	},
	title: 'Ensemblr Config',
	type: 'object',
} as const;

/** Validated declarative config loaded from `~/.config/ensemblr/config.json`. */
export interface EnsemblrConfig {
	app: Record<string, unknown>;
	environment: Record<string, unknown>;
	managed: Record<string, unknown>;
	repositoryDefaults: Record<string, unknown>;
	repositoryRules: Record<string, unknown>[];
	schemaVersion: typeof ENSEMBLR_CONFIG_SCHEMA_VERSION;
	security: Record<string, unknown>;
	ui: Record<string, unknown>;
}

/** Options for {@link loadEnsemblrConfig}. */
export interface LoadEnsemblrConfigOptions {
	configPath?: string;
	homeDirectory?: string;
	now?: () => Date;
	requireTrustedManagedConfig?: boolean;
}

/** Combined result of validating the on-disk config file. */
export interface EnsemblrConfigLoadResult {
	config: EnsemblrConfig;
	snapshot: ConfigStatusSnapshot;
}

/** Public surface of the cached config service. */
export interface EnsemblrConfigService {
	getConfig: () => EnsemblrConfig;
	getSnapshot: () => ConfigStatusSnapshot;
	load: () => ConfigStatusSnapshot;
	/**
	 * Watches config.json and reloads the cache when it changes on disk, firing
	 * `onChange` with the fresh snapshot so consumers (e.g. the renderer) can
	 * re-resolve settings. Covers the non-App sections (linear, security, managed,
	 * environment, repositoryDefaults, repositoryRules) that lack their own
	 * watcher.
	 */
	startWatching: (onChange: (snapshot: ConfigStatusSnapshot) => void) => void;
	stop: () => void;
}

/** Name of a top-level section in the on-disk Ensemblr config file. */
type SectionName =
	| 'app'
	| 'environment'
	| 'managed'
	| 'repositoryDefaults'
	| 'security'
	| 'ui';

const CONFIG_DIRECTORY = '.config/ensemblr';
const CONFIG_FILENAME = 'config.json';
/** Coalesce burst fs events (editor rename-replace fires several) before reloading. */
const CONFIG_WATCH_DEBOUNCE_MS = 100;
const ALLOWED_TOP_LEVEL_KEYS = new Set([
	'app',
	'environment',
	'managed',
	'repositoryDefaults',
	'repositoryRules',
	'schemaVersion',
	'security',
	'ui',
]);
const OBJECT_SECTIONS: readonly SectionName[] = [
	'app',
	'environment',
	'managed',
	'repositoryDefaults',
	'security',
	'ui',
];
/**
 * Computes the absolute path to the Ensemblr config file inside a home directory.
 * @param homeDirectory - Home directory to resolve against; defaults to `os.homedir()`.
 * @returns Absolute path to `config.json`.
 */
export function resolveEnsemblrConfigPath(homeDirectory = homedir()): string {
	return path.join(homeDirectory, CONFIG_DIRECTORY, CONFIG_FILENAME);
}

/**
 * Reads and validates the Ensemblr config file, returning the validated config
 * and a diagnostic snapshot suitable for IPC.
 * @param options - Optional path and clock overrides.
 * @returns The validated config and snapshot.
 */
export function loadEnsemblrConfig(
	options: LoadEnsemblrConfigOptions = {},
): EnsemblrConfigLoadResult {
	const configPath =
		options.configPath ??
		resolveEnsemblrConfigPath(options.homeDirectory ?? homedir());
	const displayPath = formatDisplayPath(
		configPath,
		options.homeDirectory ?? homedir(),
	);
	const loadedAt = (options.now ?? (() => new Date()))().toISOString();
	const requireTrustedManagedConfig =
		options.requireTrustedManagedConfig ?? false;

	if (!existsSync(configPath)) {
		return createResult({
			blocksReadiness: false,
			configPath,
			diagnostics: [
				{
					code: 'config-missing',
					message:
						'No declarative config file was found. Built-in defaults will be used.',
					severity: 'info',
				},
			],
			displayPath,
			loadedAt,
			schemaVersion: ENSEMBLR_CONFIG_SCHEMA_VERSION,
			status: 'missing',
		});
	}

	let source: string;

	try {
		source = readFileSync(configPath, 'utf8');
	} catch (error) {
		return createResult({
			blocksReadiness: requireTrustedManagedConfig,
			configPath,
			diagnostics: [
				{
					code: 'config-read-error',
					message: formatErrorMessage(error, 'Failed to read config file.'),
					severity: 'error',
				},
			],
			displayPath,
			loadedAt,
			schemaVersion: null,
			status: 'error',
		});
	}

	let parsed: unknown;

	try {
		parsed = JSON.parse(source);
	} catch (error) {
		const location = getJsonErrorLocation(source, error);

		return createResult({
			blocksReadiness: requireTrustedManagedConfig,
			configPath,
			diagnostics: [
				{
					...location,
					code: 'invalid-json',
					message: formatErrorMessage(error, 'Config file is not valid JSON.'),
					severity: 'error',
				},
			],
			displayPath,
			loadedAt,
			schemaVersion: null,
			status: 'invalid',
		});
	}

	if (!isPlainRecord(parsed)) {
		return createResult({
			blocksReadiness: requireTrustedManagedConfig,
			configPath,
			diagnostics: [
				{
					code: 'invalid-root',
					fieldPath: '$',
					message: 'Config root must be a JSON object.',
					severity: 'error',
				},
			],
			displayPath,
			loadedAt,
			schemaVersion: null,
			status: 'invalid',
		});
	}

	const validation = validateEnsemblrConfig(parsed);
	const schemaVersion = getSchemaVersion(parsed);
	const blocksReadiness =
		requireTrustedManagedConfig ||
		hasInvalidManagedSettings(parsed, validation.diagnostics);
	const status = getStatus(validation.diagnostics);

	return {
		config: validation.config,
		snapshot: {
			blocksReadiness: status === 'ok' ? false : blocksReadiness,
			diagnostics: validation.diagnostics,
			displayPath,
			loadedAt,
			path: configPath,
			schemaVersion,
			status,
		},
	};
}

/**
 * Builds the cached config service used by every consumer in the main process.
 * @param options - Forwarded to {@link loadEnsemblrConfig} on first access.
 * @returns A service that lazily loads and caches the config on first call.
 */
export function createEnsemblrConfigService(
	options: LoadEnsemblrConfigOptions = {},
): EnsemblrConfigService {
	let cachedResult: EnsemblrConfigLoadResult | null = null;
	let watcher: FSWatcher | null = null;
	let debounce: ReturnType<typeof setTimeout> | null = null;
	const configPath =
		options.configPath ??
		resolveEnsemblrConfigPath(options.homeDirectory ?? homedir());

	/** Loads the config on first call and caches the result. */
	function ensureLoaded(): EnsemblrConfigLoadResult {
		cachedResult ??= loadEnsemblrConfig(options);
		return cachedResult;
	}

	const startWatching = (
		onChange: (snapshot: ConfigStatusSnapshot) => void,
	): void => {
		const fileName = path.basename(configPath);
		// Watch the directory (not the file) so editors that save via
		// rename-replace don't orphan the watcher; filter to our filename.
		watcher = watch(path.dirname(configPath), (_event, changed) => {
			if (changed && changed !== fileName) {
				return;
			}
			if (debounce) {
				clearTimeout(debounce);
			}
			debounce = setTimeout(() => {
				cachedResult = loadEnsemblrConfig(options);
				onChange(cachedResult.snapshot);
			}, CONFIG_WATCH_DEBOUNCE_MS);
		});
	};

	const stop = (): void => {
		if (debounce) {
			clearTimeout(debounce);
			debounce = null;
		}
		watcher?.close();
		watcher = null;
	};

	return {
		getConfig: () => ensureLoaded().config,
		getSnapshot: () => ensureLoaded().snapshot,
		load: () => ensureLoaded().snapshot,
		startWatching,
		stop,
	};
}

/**
 * Type-checks a parsed config record against the supported schema, collecting
 * diagnostics and returning a sanitised {@link EnsemblrConfig}.
 * @param config - Parsed JSON record.
 * @returns The validated config and accumulated diagnostics.
 */
function validateEnsemblrConfig(config: Record<string, unknown>): {
	config: EnsemblrConfig;
	diagnostics: ConfigDiagnostic[];
} {
	const diagnostics: ConfigDiagnostic[] = [];
	const schemaVersion = getSchemaVersion(config);

	if (schemaVersion !== ENSEMBLR_CONFIG_SCHEMA_VERSION) {
		diagnostics.push({
			code: 'unsupported-schema-version',
			fieldPath: '$.schemaVersion',
			message: `Unsupported config schema version ${String(schemaVersion)}. Expected ${ENSEMBLR_CONFIG_SCHEMA_VERSION}.`,
			severity: 'error',
		});
	}

	for (const key of Object.keys(config)) {
		if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
			diagnostics.push({
				code: 'unknown-top-level-key',
				fieldPath: `$.${key}`,
				message: `Unknown top-level config key "${key}".`,
				severity: 'warning',
			});
		}
	}

	const normalized = createEmptyConfig();

	for (const section of OBJECT_SECTIONS) {
		const value = config[section];

		if (value === undefined) {
			continue;
		}

		if (!isPlainRecord(value)) {
			diagnostics.push({
				code: 'invalid-section-type',
				fieldPath: `$.${section}`,
				message: `Config section "${section}" must be an object.`,
				severity: 'error',
			});
			continue;
		}

		normalized[section] = value;
	}

	const repositoryRules = config.repositoryRules;

	if (repositoryRules !== undefined) {
		if (!Array.isArray(repositoryRules)) {
			diagnostics.push({
				code: 'invalid-section-type',
				fieldPath: '$.repositoryRules',
				message: 'Config section "repositoryRules" must be an array.',
				severity: 'error',
			});
		} else {
			normalized.repositoryRules = repositoryRules.flatMap((rule, index) => {
				if (isPlainRecord(rule)) {
					return [rule];
				}

				diagnostics.push({
					code: 'invalid-repository-rule',
					fieldPath: `$.repositoryRules[${index}]`,
					message: 'Repository matching rules must be objects.',
					severity: 'error',
				});

				return [];
			});
		}
	}

	diagnostics.push(...findRawSecretDiagnostics(config));

	return {
		config: hasErrorDiagnostics(diagnostics) ? createEmptyConfig() : normalized,
		diagnostics,
	};
}

/**
 * Builds an {@link EnsemblrConfig} populated with safe defaults.
 * @returns A defaulted config record.
 */
function createEmptyConfig(): EnsemblrConfig {
	return {
		app: {},
		environment: {},
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: ENSEMBLR_CONFIG_SCHEMA_VERSION,
		security: {},
		ui: {},
	};
}

/**
 * Helper that pairs default config with the failure snapshot for early-return paths.
 * @param input - Snapshot fields.
 * @returns A load result with defaulted config and the provided snapshot.
 */
function createResult({
	blocksReadiness,
	configPath,
	diagnostics,
	displayPath,
	loadedAt,
	schemaVersion,
	status,
}: {
	blocksReadiness: boolean;
	configPath: string;
	diagnostics: ConfigDiagnostic[];
	displayPath: string;
	loadedAt: string;
	schemaVersion: number | null;
	status: ConfigStatus;
}): EnsemblrConfigLoadResult {
	return {
		config: createEmptyConfig(),
		snapshot: {
			blocksReadiness,
			diagnostics,
			displayPath,
			loadedAt,
			path: configPath,
			schemaVersion,
			status,
		},
	};
}

/**
 * Reads the `schemaVersion` field, defaulting when missing and rejecting non-integers.
 * @param config - Parsed config record.
 * @returns The schema version, or `null` when the field is the wrong type.
 */
function getSchemaVersion(config: Record<string, unknown>): number | null {
	const value = config.schemaVersion;

	if (value === undefined) {
		return ENSEMBLR_CONFIG_SCHEMA_VERSION;
	}

	return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * Maps a diagnostic set to the overall config status.
 * @param diagnostics - Collected diagnostics.
 * @returns `'invalid'` when any error is present, otherwise `'ok'`.
 */
function getStatus(diagnostics: ConfigDiagnostic[]): ConfigStatus {
	if (hasErrorDiagnostics(diagnostics)) {
		return 'invalid';
	}

	return 'ok';
}

/**
 * Tests whether any diagnostic has `error` severity.
 * @param diagnostics - Diagnostics to inspect.
 * @returns True when at least one error is present.
 */
function hasErrorDiagnostics(diagnostics: ConfigDiagnostic[]): boolean {
	return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

/**
 * Decides whether failures in the `managed` section should block app readiness.
 * @param config - Parsed config record.
 * @param diagnostics - Collected diagnostics.
 * @returns True when readiness should be blocked.
 */
function hasInvalidManagedSettings(
	config: Record<string, unknown>,
	diagnostics: ConfigDiagnostic[],
): boolean {
	if (config.managed === undefined) {
		return false;
	}

	return diagnostics.some(
		(diagnostic) =>
			diagnostic.severity === 'error' &&
			(diagnostic.fieldPath?.startsWith('$.managed') ||
				diagnostic.code === 'unsupported-schema-version' ||
				diagnostic.code === 'raw-secret-value'),
	);
}

/**
 * Walks a value recursively and emits an error diagnostic for any sensitive-named
 * field that contains a non-empty raw string.
 * @param value - Config root or sub-tree to scan.
 * @returns A list of diagnostics, one per offending raw secret value.
 */
function findRawSecretDiagnostics(value: unknown): ConfigDiagnostic[] {
	const diagnostics: ConfigDiagnostic[] = [];

	/**
	 * Recursive walker that flags raw secret strings encountered under sensitive keys.
	 * @param current - Current value being visited.
	 * @param fieldPath - JSONPath used in diagnostic messages.
	 * @param keyName - Key that pointed at `current`, used for sensitivity checks.
	 */
	function visit(current: unknown, fieldPath: string, keyName = '') {
		if (typeof current === 'string' && isSensitiveKeyName(keyName) && current) {
			diagnostics.push({
				code: 'raw-secret-value',
				fieldPath,
				message:
					'Raw secret-like string values are not accepted in declarative config.',
				severity: 'error',
			});
			return;
		}

		if (Array.isArray(current)) {
			current.forEach((item, index) => {
				visit(item, `${fieldPath}[${index}]`);
			});
			return;
		}

		if (!isPlainRecord(current)) {
			return;
		}

		for (const [key, nextValue] of Object.entries(current)) {
			visit(nextValue, `${fieldPath}.${key}`, key);
		}
	}

	visit(value, '$');

	return diagnostics;
}

/**
 * Renders the config path with `~` substitution for diagnostic display.
 * @param configPath - Absolute config path.
 * @param homeDirectory - User home directory used to compute `~`.
 * @returns A short, user-friendly path string.
 */
function formatDisplayPath(configPath: string, homeDirectory: string): string {
	const resolvedHome = path.resolve(homeDirectory);
	const resolvedPath = path.resolve(configPath);

	if (resolvedPath === resolvedHome) {
		return '~';
	}

	if (resolvedPath.startsWith(`${resolvedHome}${path.sep}`)) {
		return `~${resolvedPath.slice(resolvedHome.length)}`;
	}

	return configPath;
}
