import { homedir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type {
	RepositorySettingsResolutionRequest,
	ResolvedSettingSnapshot,
	SettingResolutionCandidateSnapshot,
	SettingsResolutionDiagnostic,
	SettingsResolutionGroupSnapshot,
	SettingsResolutionRequest,
	SettingsResolutionScope,
	SettingsResolutionSnapshot,
	SettingsResolutionSource,
} from '../../shared/ipc';
import type { EnsembleDatabaseService } from '../storage/database';
import type { EnsembleConfig, EnsembleConfigService } from './config-loader';

export interface ResolveSettingsOptions {
	config: EnsembleConfig;
	database?: DatabaseSync | null;
	homeDirectory?: string;
	repository?: RepositorySettingsResolutionRequest;
}

export interface EnsembleConfigResolutionService {
	resolve: (request?: unknown) => SettingsResolutionSnapshot;
}

interface CreateEnsembleConfigResolutionServiceOptions {
	configService: EnsembleConfigService;
	databaseService: EnsembleDatabaseService;
	homeDirectory?: string;
}

interface Candidate {
	invalidReason?: string;
	source: SettingsResolutionSource;
	value?: unknown;
}

interface SqliteSettingRow {
	key: string;
	source: string;
	value_json: string;
}

const APP_SOURCE_ORDER: readonly SettingsResolutionSource[] = [
	'managed-config',
	'sqlite',
	'config-default',
	'built-in-default',
];

const REPOSITORY_SOURCE_ORDER: readonly SettingsResolutionSource[] = [
	'sqlite',
	'ensemble-config',
	'conductor-config',
	'built-in-default',
];

const REPOSITORY_BUILT_IN_DEFAULTS: Readonly<Record<string, unknown>> = {
	conductorCompatibility: false,
	filesToCopy: ['.env*'],
	previewUrlTemplate: null,
	runScriptMode: 'concurrent',
	'scripts.archive': null,
	'scripts.run': null,
	'scripts.setup': null,
};

export function createEnsembleConfigResolutionService({
	configService,
	databaseService,
	homeDirectory,
}: CreateEnsembleConfigResolutionServiceOptions): EnsembleConfigResolutionService {
	return {
		resolve: (request) =>
			resolveSettings({
				config: configService.getConfig(),
				database: databaseService.getConnection()?.database ?? null,
				homeDirectory,
				repository: normalizeSettingsResolutionRequest(request).repository,
			}),
	};
}

export function resolveSettings({
	config,
	database = null,
	homeDirectory = homedir(),
	repository,
}: ResolveSettingsOptions): SettingsResolutionSnapshot {
	const appConfigDefaults = collectAppConfigDefaults(config);
	const appLockedKeys = collectManagedLockedKeys(config.managed);
	const appCandidates = new Map<string, Candidate[]>();

	addCandidates(
		appCandidates,
		collectManagedAppCandidates(config, appConfigDefaults, appLockedKeys),
		'managed-config',
	);
	addCandidates(
		appCandidates,
		collectSqliteSettings(database, 'app', ''),
		'sqlite',
	);
	addCandidates(appCandidates, appConfigDefaults, 'config-default');
	addCandidates(
		appCandidates,
		collectAppBuiltInDefaults(homeDirectory),
		'built-in-default',
	);

	const snapshot: SettingsResolutionSnapshot = {
		app: resolveCandidateGroup({
			candidatesByKey: appCandidates,
			lockedKeys: appLockedKeys,
			scope: 'app',
			sourceOrder: APP_SOURCE_ORDER,
		}),
	};

	if (repository) {
		const repositoryCandidates = new Map<string, Candidate[]>();

		addCandidates(
			repositoryCandidates,
			collectSqliteSettings(database, 'repository', repository.repositoryId),
			'sqlite',
		);
		addCandidates(
			repositoryCandidates,
			flattenRecord(repository.ensembleConfig ?? {}),
			'ensemble-config',
		);
		addCandidates(
			repositoryCandidates,
			collectConductorConfigCandidates(repository.conductorConfig),
			'conductor-config',
		);
		addCandidates(
			repositoryCandidates,
			new Map(Object.entries(REPOSITORY_BUILT_IN_DEFAULTS)),
			'built-in-default',
		);

		snapshot.repository = resolveCandidateGroup({
			candidatesByKey: repositoryCandidates,
			lockedKeys: new Set(),
			scope: 'repository',
			sourceOrder: REPOSITORY_SOURCE_ORDER,
		});
	}

	return snapshot;
}

export function normalizeSettingsResolutionRequest(
	request: unknown,
): SettingsResolutionRequest {
	if (!isPlainRecord(request)) {
		return {};
	}

	if (!isPlainRecord(request.repository)) {
		return {};
	}

	const repositoryId =
		typeof request.repository.repositoryId === 'string'
			? request.repository.repositoryId.trim()
			: '';

	if (!repositoryId) {
		return {};
	}

	return {
		repository: {
			conductorConfig: isPlainRecord(request.repository.conductorConfig)
				? request.repository.conductorConfig
				: undefined,
			ensembleConfig: isPlainRecord(request.repository.ensembleConfig)
				? request.repository.ensembleConfig
				: undefined,
			repositoryId,
		},
	};
}

function resolveCandidateGroup({
	candidatesByKey,
	lockedKeys,
	scope,
	sourceOrder,
}: {
	candidatesByKey: Map<string, Candidate[]>;
	lockedKeys: Set<string>;
	scope: SettingsResolutionScope;
	sourceOrder: readonly SettingsResolutionSource[];
}): SettingsResolutionGroupSnapshot {
	const diagnostics: SettingsResolutionDiagnostic[] = [];
	const settings: ResolvedSettingSnapshot[] = [];

	for (const key of Array.from(candidatesByKey.keys()).sort()) {
		const candidates = orderCandidates(
			candidatesByKey.get(key) ?? [],
			sourceOrder,
		);
		const selected = selectCandidate(key, candidates, lockedKeys);
		const candidateSnapshots = createCandidateSnapshots({
			candidates,
			key,
			lockedKeys,
			selected,
		});

		for (const candidate of candidateSnapshots) {
			diagnostics.push({
				key,
				message: candidate.reason,
				scope,
				source: candidate.source,
				status: candidate.status,
			});
		}

		if (!selected) {
			continue;
		}

		settings.push({
			candidates: candidateSnapshots,
			key,
			locked: lockedKeys.has(key),
			source: selected.source,
			value: selected.value,
		});
	}

	return { diagnostics, settings };
}

function selectCandidate(
	key: string,
	candidates: readonly Candidate[],
	lockedKeys: Set<string>,
): Candidate | null {
	for (const candidate of candidates) {
		if (candidate.invalidReason) {
			continue;
		}

		if (candidate.source === 'sqlite' && lockedKeys.has(key)) {
			continue;
		}

		return candidate;
	}

	return null;
}

function createCandidateSnapshots({
	candidates,
	key,
	lockedKeys,
	selected,
}: {
	candidates: readonly Candidate[];
	key: string;
	lockedKeys: Set<string>;
	selected: Candidate | null;
}): SettingResolutionCandidateSnapshot[] {
	return candidates.map((candidate) => {
		if (candidate.invalidReason) {
			return {
				reason: candidate.invalidReason,
				source: candidate.source,
				status: 'invalid',
			};
		}

		if (candidate.source === 'sqlite' && lockedKeys.has(key)) {
			return {
				reason: 'Ignored because this setting is locked by managed config.',
				source: candidate.source,
				status: 'ignored',
			};
		}

		if (selected === candidate) {
			return {
				reason: 'Selected by precedence.',
				source: candidate.source,
				status: 'selected',
			};
		}

		return {
			reason: selected
				? `Ignored because ${selected.source} has higher precedence.`
				: 'Ignored because no valid value could be selected.',
			source: candidate.source,
			status: 'ignored',
		};
	});
}

function orderCandidates(
	candidates: readonly Candidate[],
	sourceOrder: readonly SettingsResolutionSource[],
): Candidate[] {
	const sourceRank = new Map(
		sourceOrder.map((source, index) => [source, index] as const),
	);

	return [...candidates].sort((left, right) => {
		const leftRank = sourceRank.get(left.source) ?? sourceOrder.length;
		const rightRank = sourceRank.get(right.source) ?? sourceOrder.length;

		if (leftRank !== rightRank) {
			return leftRank - rightRank;
		}

		return left.source.localeCompare(right.source);
	});
}

function addCandidates(
	candidatesByKey: Map<string, Candidate[]>,
	values: Map<string, unknown | Candidate>,
	source: SettingsResolutionSource,
): void {
	for (const [key, value] of values) {
		const candidate = isCandidate(value) ? value : { source, value };
		const existing = candidatesByKey.get(key) ?? [];
		existing.push(candidate);
		candidatesByKey.set(key, existing);
	}
}

function collectAppBuiltInDefaults(
	homeDirectory: string,
): Map<string, unknown> {
	return new Map([
		['rootDirectory', path.join(homeDirectory, 'Ensemble')],
		['security.permissionMode', 'workspace-trusted'],
		['sendShortcut', 'enter'],
		['ui.theme', 'system'],
	]);
}

function collectConductorConfigCandidates(
	conductorConfig?: Record<string, unknown>,
): Map<string, unknown> {
	const candidates = flattenRecord(conductorConfig ?? {});

	if (conductorConfig && !candidates.has('conductorCompatibility')) {
		candidates.set('conductorCompatibility', true);
	}

	return candidates;
}

function collectAppConfigDefaults(
	config: EnsembleConfig,
): Map<string, unknown> {
	const defaults = new Map<string, unknown>();

	for (const [key, value] of flattenRecord(config.app)) {
		defaults.set(key, value);
	}

	for (const [key, value] of flattenRecord(config.security, 'security')) {
		defaults.set(key, value);
	}

	for (const [key, value] of flattenRecord(config.ui, 'ui')) {
		defaults.set(key, value);
	}

	for (const [key, value] of flattenRecord(
		config.repositoryDefaults,
		'repositoryDefaults',
	)) {
		defaults.set(key, value);
	}

	return defaults;
}

function collectManagedAppCandidates(
	config: EnsembleConfig,
	appConfigDefaults: Map<string, unknown>,
	lockedKeys: Set<string>,
): Map<string, unknown> {
	const managedValues = collectManagedValues(config.managed);
	const candidates = new Map<string, unknown>();

	for (const key of lockedKeys) {
		if (managedValues.has(key)) {
			candidates.set(key, managedValues.get(key));
			continue;
		}

		if (appConfigDefaults.has(key)) {
			candidates.set(key, appConfigDefaults.get(key));
		}
	}

	return candidates;
}

function collectManagedValues(
	managed: Record<string, unknown>,
): Map<string, unknown> {
	const values = new Map<string, unknown>();

	if (isPlainRecord(managed.values)) {
		for (const [key, value] of flattenRecord(managed.values)) {
			values.set(key, value);
		}
	}

	const directManagedValues: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(managed)) {
		if (key === 'locked' || key === 'values') {
			continue;
		}

		directManagedValues[key] = value;
	}

	for (const [key, value] of flattenRecord(directManagedValues)) {
		values.set(key, value);
	}

	return values;
}

function collectManagedLockedKeys(
	managed: Record<string, unknown>,
): Set<string> {
	if (!isPlainRecord(managed.locked)) {
		return new Set();
	}

	const lockedKeys = new Set<string>();

	for (const [key, value] of flattenRecord(managed.locked)) {
		if (value === true) {
			lockedKeys.add(key);
		}
	}

	return lockedKeys;
}

function collectSqliteSettings(
	database: DatabaseSync | null,
	scope: SettingsResolutionScope,
	scopeId: string,
): Map<string, Candidate> {
	const candidates = new Map<string, Candidate>();

	if (!database) {
		return candidates;
	}

	const rows = database
		.prepare(
			`SELECT key, source, value_json
			 FROM settings
			 WHERE scope = ? AND scope_id = ?
			 ORDER BY key`,
		)
		.all(scope, scopeId);

	for (const row of rows) {
		if (!isSqliteSettingRow(row) || row.source !== 'sqlite') {
			continue;
		}

		try {
			candidates.set(row.key, {
				source: 'sqlite',
				value: JSON.parse(row.value_json),
			});
		} catch {
			candidates.set(row.key, {
				invalidReason: 'Stored SQLite setting value is not valid JSON.',
				source: 'sqlite',
			});
		}
	}

	return candidates;
}

function flattenRecord(
	record: Record<string, unknown>,
	prefix = '',
): Map<string, unknown> {
	const flattened = new Map<string, unknown>();

	for (const [key, value] of Object.entries(record)) {
		const fieldPath = prefix ? `${prefix}.${key}` : key;

		if (isPlainRecord(value)) {
			for (const [nestedKey, nestedValue] of flattenRecord(value, fieldPath)) {
				flattened.set(nestedKey, nestedValue);
			}
			continue;
		}

		flattened.set(fieldPath, value);
	}

	return flattened;
}

function isCandidate(value: unknown): value is Candidate {
	return (
		isPlainRecord(value) &&
		typeof value.source === 'string' &&
		('value' in value || 'invalidReason' in value)
	);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSqliteSettingRow(row: unknown): row is SqliteSettingRow {
	return (
		isPlainRecord(row) &&
		typeof row.key === 'string' &&
		typeof row.source === 'string' &&
		typeof row.value_json === 'string'
	);
}
