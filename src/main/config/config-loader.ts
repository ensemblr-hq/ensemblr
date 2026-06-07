import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type {
	ConfigDiagnostic,
	ConfigStatus,
	ConfigStatusSnapshot,
} from '../../shared/ipc';
import { formatErrorMessage, isPlainRecord } from './json-utils.ts';

export type { ConfigDiagnostic, ConfigStatusSnapshot };

/** Schema version embedded in `~/.config/ensemble/config.json`. */
export const ENSEMBLE_CONFIG_SCHEMA_VERSION = 1;

/** JSON Schema describing the supported top-level shape of the Ensemble config. */
export const ENSEMBLE_CONFIG_SCHEMA = {
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
		schemaVersion: { const: ENSEMBLE_CONFIG_SCHEMA_VERSION },
		security: { type: 'object' },
		ui: { type: 'object' },
	},
	title: 'Ensemble Config',
	type: 'object',
} as const;

/** Validated declarative config loaded from `~/.config/ensemble/config.json`. */
export interface EnsembleConfig {
	app: Record<string, unknown>;
	environment: Record<string, unknown>;
	managed: Record<string, unknown>;
	repositoryDefaults: Record<string, unknown>;
	repositoryRules: Record<string, unknown>[];
	schemaVersion: typeof ENSEMBLE_CONFIG_SCHEMA_VERSION;
	security: Record<string, unknown>;
	ui: Record<string, unknown>;
}

/** Options for {@link loadEnsembleConfig}. */
export interface LoadEnsembleConfigOptions {
	configPath?: string;
	homeDirectory?: string;
	now?: () => Date;
	requireTrustedManagedConfig?: boolean;
}

/** Combined result of validating the on-disk config file. */
export interface EnsembleConfigLoadResult {
	config: EnsembleConfig;
	snapshot: ConfigStatusSnapshot;
}

/** Public surface of the cached config service. */
export interface EnsembleConfigService {
	getConfig: () => EnsembleConfig;
	getSnapshot: () => ConfigStatusSnapshot;
	load: () => ConfigStatusSnapshot;
}

type SectionName =
	| 'app'
	| 'environment'
	| 'managed'
	| 'repositoryDefaults'
	| 'security'
	| 'ui';

const CONFIG_DIRECTORY = '.config/ensemble';
const CONFIG_FILENAME = 'config.json';
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
const SENSITIVE_KEY_PARTS = [
	'accesstoken',
	'apikey',
	'credential',
	'password',
	'privatekey',
	'secret',
	'token',
];

/**
 * Computes the absolute path to the Ensemble config file inside a home directory.
 * @param homeDirectory - Home directory to resolve against; defaults to `os.homedir()`.
 * @returns Absolute path to `config.json`.
 */
export function resolveEnsembleConfigPath(homeDirectory = homedir()): string {
	return path.join(homeDirectory, CONFIG_DIRECTORY, CONFIG_FILENAME);
}

/**
 * Reads and validates the Ensemble config file, returning the validated config
 * and a diagnostic snapshot suitable for IPC.
 * @param options - Optional path and clock overrides.
 * @returns The validated config and snapshot.
 */
export function loadEnsembleConfig(
	options: LoadEnsembleConfigOptions = {},
): EnsembleConfigLoadResult {
	const configPath =
		options.configPath ??
		resolveEnsembleConfigPath(options.homeDirectory ?? homedir());
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
			schemaVersion: ENSEMBLE_CONFIG_SCHEMA_VERSION,
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

	const validation = validateEnsembleConfig(parsed);
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
 * @param options - Forwarded to {@link loadEnsembleConfig} on first access.
 * @returns A service that lazily loads and caches the config on first call.
 */
export function createEnsembleConfigService(
	options: LoadEnsembleConfigOptions = {},
): EnsembleConfigService {
	let cachedResult: EnsembleConfigLoadResult | null = null;

	/** Loads the config on first call and caches the result. */
	function ensureLoaded(): EnsembleConfigLoadResult {
		cachedResult ??= loadEnsembleConfig(options);
		return cachedResult;
	}

	return {
		getConfig: () => ensureLoaded().config,
		getSnapshot: () => ensureLoaded().snapshot,
		load: () => ensureLoaded().snapshot,
	};
}

/**
 * Type-checks a parsed config record against the supported schema, collecting
 * diagnostics and returning a sanitised {@link EnsembleConfig}.
 * @param config - Parsed JSON record.
 * @returns The validated config and accumulated diagnostics.
 */
function validateEnsembleConfig(config: Record<string, unknown>): {
	config: EnsembleConfig;
	diagnostics: ConfigDiagnostic[];
} {
	const diagnostics: ConfigDiagnostic[] = [];
	const schemaVersion = getSchemaVersion(config);

	if (schemaVersion !== ENSEMBLE_CONFIG_SCHEMA_VERSION) {
		diagnostics.push({
			code: 'unsupported-schema-version',
			fieldPath: '$.schemaVersion',
			message: `Unsupported config schema version ${String(schemaVersion)}. Expected ${ENSEMBLE_CONFIG_SCHEMA_VERSION}.`,
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
 * Builds an {@link EnsembleConfig} populated with safe defaults.
 * @returns A defaulted config record.
 */
function createEmptyConfig(): EnsembleConfig {
	return {
		app: {},
		environment: {},
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: ENSEMBLE_CONFIG_SCHEMA_VERSION,
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
}): EnsembleConfigLoadResult {
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
		return ENSEMBLE_CONFIG_SCHEMA_VERSION;
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
		if (typeof current === 'string' && isSensitiveKey(keyName) && current) {
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
 * Tests whether a key name looks sensitive (e.g. contains "token" or "secret").
 * @param keyName - Key to test.
 * @returns True when the normalised key contains a sensitive substring.
 */
function isSensitiveKey(keyName: string): boolean {
	const normalized = keyName.replace(/[-_]/g, '').toLowerCase();

	return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

/**
 * Extracts a line/column hint from a JSON parser error message, recognising
 * both `position N` and `line N column M` shapes.
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
		return getLocationForPosition(source, position);
	}

	const lineColumnMatch = /line (\d+) column (\d+)/i.exec(message);

	if (lineColumnMatch) {
		return {
			column: Number(lineColumnMatch[2]),
			line: Number(lineColumnMatch[1]),
		};
	}

	return {};
}

/**
 * Converts a character offset into a 1-based `(line, column)` pair.
 * @param source - Source text.
 * @param position - Character offset within `source`.
 * @returns A partial diagnostic with `line` and `column`.
 */
function getLocationForPosition(
	source: string,
	position: number,
): Pick<ConfigDiagnostic, 'column' | 'line'> {
	const beforePosition = source.slice(0, Math.max(0, position));
	const lines = beforePosition.split('\n');

	return {
		column: (lines.at(-1)?.length ?? 0) + 1,
		line: lines.length,
	};
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

