import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type {
	ConfigDiagnostic,
	ConfigStatus,
	ConfigStatusSnapshot,
} from '../../shared/ipc';

export type { ConfigDiagnostic, ConfigStatusSnapshot };

export const PIDUCTOR_CONFIG_SCHEMA_VERSION = 1;

export const PIDUCTOR_CONFIG_SCHEMA = {
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
		schemaVersion: { const: PIDUCTOR_CONFIG_SCHEMA_VERSION },
		security: { type: 'object' },
		ui: { type: 'object' },
	},
	title: 'Piductor Config',
	type: 'object',
} as const;

export interface PiductorConfig {
	app: Record<string, unknown>;
	environment: Record<string, unknown>;
	managed: Record<string, unknown>;
	repositoryDefaults: Record<string, unknown>;
	repositoryRules: Record<string, unknown>[];
	schemaVersion: typeof PIDUCTOR_CONFIG_SCHEMA_VERSION;
	security: Record<string, unknown>;
	ui: Record<string, unknown>;
}

export interface LoadPiductorConfigOptions {
	configPath?: string;
	homeDirectory?: string;
	now?: () => Date;
	requireTrustedManagedConfig?: boolean;
}

export interface PiductorConfigLoadResult {
	config: PiductorConfig;
	snapshot: ConfigStatusSnapshot;
}

export interface PiductorConfigService {
	getConfig: () => PiductorConfig;
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

const CONFIG_DIRECTORY = '.config/piductor';
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

export function resolvePiductorConfigPath(homeDirectory = homedir()): string {
	return path.join(homeDirectory, CONFIG_DIRECTORY, CONFIG_FILENAME);
}

export function loadPiductorConfig(
	options: LoadPiductorConfigOptions = {},
): PiductorConfigLoadResult {
	const configPath =
		options.configPath ??
		resolvePiductorConfigPath(options.homeDirectory ?? homedir());
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
			schemaVersion: PIDUCTOR_CONFIG_SCHEMA_VERSION,
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

	const validation = validatePiductorConfig(parsed);
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

export function createPiductorConfigService(
	options: LoadPiductorConfigOptions = {},
): PiductorConfigService {
	let cachedResult: PiductorConfigLoadResult | null = null;

	function ensureLoaded(): PiductorConfigLoadResult {
		cachedResult ??= loadPiductorConfig(options);
		return cachedResult;
	}

	return {
		getConfig: () => ensureLoaded().config,
		getSnapshot: () => ensureLoaded().snapshot,
		load: () => ensureLoaded().snapshot,
	};
}

function validatePiductorConfig(config: Record<string, unknown>): {
	config: PiductorConfig;
	diagnostics: ConfigDiagnostic[];
} {
	const diagnostics: ConfigDiagnostic[] = [];
	const schemaVersion = getSchemaVersion(config);

	if (schemaVersion !== PIDUCTOR_CONFIG_SCHEMA_VERSION) {
		diagnostics.push({
			code: 'unsupported-schema-version',
			fieldPath: '$.schemaVersion',
			message: `Unsupported config schema version ${String(schemaVersion)}. Expected ${PIDUCTOR_CONFIG_SCHEMA_VERSION}.`,
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

function createEmptyConfig(): PiductorConfig {
	return {
		app: {},
		environment: {},
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: PIDUCTOR_CONFIG_SCHEMA_VERSION,
		security: {},
		ui: {},
	};
}

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
}): PiductorConfigLoadResult {
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

function getSchemaVersion(config: Record<string, unknown>): number | null {
	const value = config.schemaVersion;

	if (value === undefined) {
		return PIDUCTOR_CONFIG_SCHEMA_VERSION;
	}

	return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function getStatus(diagnostics: ConfigDiagnostic[]): ConfigStatus {
	if (hasErrorDiagnostics(diagnostics)) {
		return 'invalid';
	}

	return 'ok';
}

function hasErrorDiagnostics(diagnostics: ConfigDiagnostic[]): boolean {
	return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

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

function findRawSecretDiagnostics(value: unknown): ConfigDiagnostic[] {
	const diagnostics: ConfigDiagnostic[] = [];

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

function isSensitiveKey(keyName: string): boolean {
	const normalized = keyName.replace(/[-_]/g, '').toLowerCase();

	return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

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

function formatErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
