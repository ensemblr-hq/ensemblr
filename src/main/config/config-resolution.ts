import { homedir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { GitSettings } from '../../shared/config/app-settings.ts';
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
} from '../../shared/ipc/contracts/settings-resolution';
import type { EnsemblrDatabaseService } from '../storage/database';
import type { AppSettingsService } from './app-settings-service.ts';
import type { EnsemblrConfig, EnsemblrConfigService } from './config-loader';
import { isPlainRecord } from './json-utils.ts';
import { loadRepositoryConfig } from './repository-config.ts';

/** Inputs for the pure {@link resolveSettings} function. */
export interface ResolveSettingsOptions {
	config: EnsemblrConfig;
	database?: DatabaseSync | null;
	homeDirectory?: string;
	repository?: RepositorySettingsResolutionRequest;
	/**
	 * Overrides the built-in default Ensemblr root directory (`~/Ensemblr`).
	 * Used to isolate the dogfood dev build onto its own repo/workspace root.
	 */
	rootDirectory?: string;
	/**
	 * User-scope git defaults from `config.json` (`app.git`). Fed into the
	 * repository scope as the `user-default` source so personal defaults apply
	 * to every repo, while any repo-scoped value still wins.
	 */
	userGitDefaults?: GitSettings;
}

/** Service that resolves settings on demand for IPC consumers. */
export interface EnsemblrConfigResolutionService {
	resolve: (request?: unknown) => SettingsResolutionSnapshot;
}

/** Options for {@link createEnsemblrConfigResolutionService}. */
interface CreateEnsemblrConfigResolutionServiceOptions {
	appSettingsService: AppSettingsService;
	configService: EnsemblrConfigService;
	databaseService: EnsemblrDatabaseService;
	homeDirectory?: string;
	/** Overrides the default Ensemblr root directory (dogfood dev build). */
	rootDirectory?: string;
}

/** Internal: one candidate value for a setting, before precedence selection. */
interface Candidate {
	invalidReason?: string;
	source: SettingsResolutionSource;
	value?: unknown;
}

/** Internal: shape of a row read from the SQLite `settings` table. */
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
	'worktreeinclude',
	'ensemblr-config',
	'sqlite',
	'user-default',
	'built-in-default',
];

const DEFAULT_PERMISSION_MODE = 'workspace-trusted';
const VALID_PERMISSION_MODES = [
	'workspace-trusted',
	'approval-required',
	'read-only',
] as const;

const REPOSITORY_BUILT_IN_DEFAULTS: Readonly<Record<string, unknown>> = {
	archiveAfterMerge: false,
	autoRunAfterSetup: false,
	deleteLocalBranchOnArchive: false,
	filesToCopy: ['.env*'],
	'piActions.branchNaming': null,
	'piActions.createPr': null,
	'piActions.fixCheckErrors': null,
	'piActions.general': null,
	'piActions.resolveConflicts': null,
	'piActions.review': null,
	previewUrlTemplate: null,
	runScriptMode: 'concurrent',
	'security.permissionMode': DEFAULT_PERMISSION_MODE,
	setUpstreamOnPush: true,
	'scripts.archive': null,
	'scripts.run': null,
	'scripts.setup': null,
};

const VALIDATED_SETTING_KEYS = new Set(['security.permissionMode']);

/**
 * Builds the settings-resolution service consumed by IPC handlers, wiring the
 * config and database services together.
 * @param options - Service dependencies and home-directory override.
 * @returns A {@link EnsemblrConfigResolutionService}.
 */
export function createEnsemblrConfigResolutionService({
	appSettingsService,
	configService,
	databaseService,
	homeDirectory,
	rootDirectory,
}: CreateEnsemblrConfigResolutionServiceOptions): EnsemblrConfigResolutionService {
	return {
		resolve: (request) =>
			resolveSettings({
				config: configService.getConfig(),
				database: databaseService.getConnection()?.database ?? null,
				homeDirectory,
				repository: normalizeSettingsResolutionRequest(request).repository,
				rootDirectory,
				userGitDefaults: appSettingsService.read().git,
			}),
	};
}

/**
 * Resolves the effective app (and optional repository) settings by merging every
 * supported source and applying precedence rules.
 * @param options - Validated config, database, repository, and home-directory inputs.
 * @returns A diagnostic-rich snapshot of every resolved setting.
 */
export function resolveSettings({
	config,
	database = null,
	homeDirectory = homedir(),
	repository,
	rootDirectory,
	userGitDefaults,
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
		collectAppBuiltInDefaults(homeDirectory, rootDirectory),
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
		const repositoryFileConfig = repository.repositoryPath
			? loadRepositoryConfig({ repositoryPath: repository.repositoryPath })
			: null;

		if (repositoryFileConfig?.worktreeincludeConfig) {
			addCandidates(
				repositoryCandidates,
				flattenRecord(repositoryFileConfig.worktreeincludeConfig),
				'worktreeinclude',
			);
		}
		addCandidates(
			repositoryCandidates,
			flattenRecord(
				repository.ensemblrConfig ?? repositoryFileConfig?.ensemblrConfig ?? {},
			),
			'ensemblr-config',
		);
		addCandidates(
			repositoryCandidates,
			collectSqliteSettings(database, 'repository', repository.repositoryId),
			'sqlite',
		);
		addCandidates(
			repositoryCandidates,
			collectUserGitDefaultCandidates(userGitDefaults),
			'user-default',
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

/**
 * Coerces an IPC payload into a {@link SettingsResolutionRequest}, rejecting
 * requests that lack both a repository ID and path.
 * @param request - Raw IPC payload.
 * @returns A safe-to-use request.
 */
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
	const repositoryPath =
		typeof request.repository.repositoryPath === 'string'
			? request.repository.repositoryPath.trim()
			: '';

	if (!repositoryId && !repositoryPath) {
		return {};
	}

	return {
		repository: {
			ensemblrConfig: isPlainRecord(request.repository.ensemblrConfig)
				? request.repository.ensemblrConfig
				: undefined,
			repositoryId: repositoryId || repositoryPath,
			...(repositoryPath ? { repositoryPath } : {}),
		},
	};
}

/**
 * Resolves a single scope (app or repository) by selecting one candidate per
 * key according to source order and locked-key rules.
 * @param input - Candidates, locked keys, scope identifier and source order.
 * @returns The resolved settings plus per-candidate diagnostics.
 */
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

/**
 * Picks the first valid candidate, skipping invalid ones and SQLite candidates
 * whose key is locked by managed config.
 * @param key - Setting key.
 * @param candidates - Pre-ordered candidates.
 * @param lockedKeys - Keys locked by managed config.
 * @returns The selected candidate, or `null` when none are valid.
 */
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

/**
 * Converts ordered candidates into per-source snapshot rows with status and
 * reason strings explaining why each was selected or ignored.
 * @param input - Candidates plus the chosen one and locked-key context.
 * @returns One snapshot row per candidate.
 */
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

/**
 * Sorts candidates by source precedence; unknown sources fall after every known one.
 * @param candidates - Candidates to order.
 * @param sourceOrder - Precedence array.
 * @returns A new array sorted by source rank.
 */
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

/**
 * Adds candidate values from a single source into the per-key candidate map,
 * validating each entry before appending.
 * @param candidatesByKey - Mutable map of accumulated candidates.
 * @param values - Either raw values or already-built {@link Candidate}s.
 * @param source - Source identifier assigned to raw values.
 */
function addCandidates(
	candidatesByKey: Map<string, Candidate[]>,
	values: Map<string, unknown | Candidate>,
	source: SettingsResolutionSource,
): void {
	for (const [key, value] of values) {
		const candidate = isCandidate(value) ? value : { source, value };
		const validatedCandidate = validateSettingCandidate(key, candidate);
		const existing = candidatesByKey.get(key) ?? [];
		existing.push(validatedCandidate);
		candidatesByKey.set(key, existing);
	}
}

/**
 * Built-in fallback defaults for the app scope, including the default Ensemblr
 * root directory derived from the user's home.
 * @param homeDirectory - User home directory.
 * @param rootDirectory - Explicit root-directory override; defaults to `<home>/Ensemblr`.
 * @returns Flat map of `key -> value`.
 */
function collectAppBuiltInDefaults(
	homeDirectory: string,
	rootDirectory?: string,
): Map<string, unknown> {
	return new Map([
		['rootDirectory', rootDirectory ?? path.join(homeDirectory, 'Ensemblr')],
		['security.permissionMode', DEFAULT_PERMISSION_MODE],
		['sendShortcut', 'enter'],
		['ui.theme', 'system'],
	]);
}

/**
 * Applies per-key validation to a candidate, marking invalid candidates with a
 * reason rather than discarding them.
 * @param key - Setting key.
 * @param candidate - Candidate to validate.
 * @returns The original candidate or a copy with `invalidReason` set.
 */
function validateSettingCandidate(
	key: string,
	candidate: Candidate,
): Candidate {
	if (candidate.invalidReason || !VALIDATED_SETTING_KEYS.has(key)) {
		return candidate;
	}

	if (key === 'security.permissionMode') {
		const invalidReason = getInvalidPermissionModeReason(candidate.value);

		if (invalidReason) {
			return {
				...candidate,
				invalidReason,
				value: undefined,
			};
		}
	}

	return candidate;
}

/**
 * Returns a diagnostic reason when a value is not a valid permission mode.
 * @param value - Candidate value.
 * @returns Reason string, or `null` when valid.
 */
function getInvalidPermissionModeReason(value: unknown): string | null {
	if (
		typeof value === 'string' &&
		VALID_PERMISSION_MODES.includes(
			value as (typeof VALID_PERMISSION_MODES)[number],
		)
	) {
		return null;
	}

	const formattedValue =
		typeof value === 'string' ? `"${value}"` : typeof value;

	return `Invalid permission mode ${formattedValue}. Expected one of: ${VALID_PERMISSION_MODES.join(', ')}.`;
}

/**
 * Maps user-scope git defaults (`app.git` in config.json) onto repository
 * resolution keys, contributing them as the `user-default` source. Branch-prefix
 * and rename-on-branch are intentionally excluded: the former needs async `gh`
 * resolution performed at workspace creation, the latter is a renderer-only
 * behavior read straight from app settings.
 * @param git - User git defaults, when available.
 * @returns Flat map of repo `key -> value`.
 */
function collectUserGitDefaultCandidates(
	git?: GitSettings,
): Map<string, unknown> {
	const candidates = new Map<string, unknown>();

	if (!git) {
		return candidates;
	}

	candidates.set('deleteLocalBranchOnArchive', git.deleteLocalBranchOnArchive);
	candidates.set('archiveAfterMerge', git.archiveAfterMerge);
	candidates.set('setUpstreamOnPush', git.setUpstreamOnPush);

	return candidates;
}

/**
 * Builds the app-scope `config-default` candidates by flattening the relevant
 * sections of the declarative config under their canonical key prefixes.
 * @param config - Validated declarative config.
 * @returns Flat map of `key -> value`.
 */
function collectAppConfigDefaults(
	config: EnsemblrConfig,
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

/**
 * For each locked key, returns the managed value (if any) or falls back to the
 * matching config default.
 * @param config - Declarative config.
 * @param appConfigDefaults - Already-flattened app defaults.
 * @param lockedKeys - Keys locked by managed config.
 * @returns Flat map of `key -> value`.
 */
function collectManagedAppCandidates(
	config: EnsemblrConfig,
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

/**
 * Extracts managed values from both the `managed.values` block and the legacy
 * top-level managed keys, ignoring the `locked` block.
 * @param managed - Raw `managed` config section.
 * @returns Flat map of `key -> value`.
 */
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

/**
 * Reads the boolean `managed.locked` tree and returns the set of locked keys.
 * @param managed - Raw `managed` config section.
 * @returns Set of dotted locked keys.
 */
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

/**
 * Reads persisted setting candidates from the SQLite `settings` table, marking
 * rows with unparseable JSON as invalid rather than dropping them.
 * @param database - Open SQLite connection or `null`.
 * @param scope - Settings scope.
 * @param scopeId - Scope identifier (e.g. repository id).
 * @returns Map of `key -> candidate`.
 */
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

/**
 * Flattens a nested object into a dotted-key map; arrays and primitives become
 * leaves at their containing path.
 * @param record - Source record.
 * @param prefix - Key prefix used during recursion.
 * @returns Flat map of dotted-keys to leaf values.
 */
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

/**
 * Type guard for already-built {@link Candidate} entries.
 * @param value - Candidate value.
 * @returns True when the shape matches.
 */
function isCandidate(value: unknown): value is Candidate {
	return (
		isPlainRecord(value) &&
		typeof value.source === 'string' &&
		('value' in value || 'invalidReason' in value)
	);
}

/**
 * Type guard for the row shape returned by the settings table query.
 * @param row - Candidate row value.
 * @returns True when the row has the expected columns.
 */
function isSqliteSettingRow(row: unknown): row is SqliteSettingRow {
	return (
		isPlainRecord(row) &&
		typeof row.key === 'string' &&
		typeof row.source === 'string' &&
		typeof row.value_json === 'string'
	);
}
