import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type {
	ConfigDiagnostic,
	RepositoryConfigMigrationChange,
	RepositoryConfigMigrationPreview,
	RepositoryConfigMigrationRequest,
	RepositoryConfigMigrationResult,
	RepositoryConfigSourceSnapshot,
	SettingsResolutionSource,
} from '../../shared/ipc';
import {
	areJsonValuesEqual,
	cloneRecord,
	formatErrorMessage,
	isPlainRecord,
} from './json-utils.ts';
import {
	ENSEMBLE_CONFIG_FILENAME,
	type LoadRepositoryConfigOptions,
	loadRepositoryConfig,
	readJsonFile,
} from './repository-config.ts';

/** Internal: one key/value pair flagged for migration. */
interface MigrationEntry {
	key: string;
	source: SettingsResolutionSource;
	value: unknown;
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
 * Computes what {@link applyRepositoryConfigMigration} would do, including the
 * resulting `ensemble.json`, per-key change classifications, and diagnostics.
 * @param request - Migration request (path + overwrite flag).
 * @returns Preview describing whether the migration can apply and what changes.
 */
export function previewRepositoryConfigMigration(
	request: RepositoryConfigMigrationRequest,
): RepositoryConfigMigrationPreview {
	if (!request.repositoryPath.trim()) {
		return createEmptyMigrationPreview({
			diagnostics: [
				{
					code: 'repository-path-missing',
					message: 'No repository path was provided.',
					severity: 'error',
				},
			],
			repositoryPath: '',
		});
	}

	const repositoryPath = path.resolve(request.repositoryPath);
	const overwrite = request.overwrite === true;
	const loaded = loadRepositoryConfig({ repositoryPath });
	const targetPath = path.join(repositoryPath, ENSEMBLE_CONFIG_FILENAME);
	const diagnostics = [...loaded.snapshot.diagnostics];
	const target = readJsonFile({
		kind: 'ensemble',
		source: 'ensemble-config',
		sourcePath: targetPath,
	});
	const sourceSnapshot = getMigrationSource(loaded.snapshot.sources);
	const sourcePath = sourceSnapshot?.path ?? null;
	const entries = sourceSnapshot
		? collectMigrationEntries(sourceSnapshot.settings, sourceSnapshot.source)
		: [];

	if (!sourceSnapshot) {
		diagnostics.push({
			code: 'migration-source-missing',
			message:
				'No shared Conductor repository config was found to migrate into ensemble.json.',
			severity: 'info',
		});
	}

	const targetConfig = target.record ?? {};
	const targetIsInvalid = target.status === 'invalid';
	const resultingConfig = cloneRecord(targetConfig);
	const changes: RepositoryConfigMigrationChange[] = [];

	if (!targetIsInvalid) {
		for (const entry of entries) {
			const existingPath = inspectValueAtPath(targetConfig, entry.key);
			const existingValue = existingPath.existingValue;
			const hasExistingValue = existingPath.hasExistingValue;
			const valuesMatch =
				hasExistingValue && areJsonValuesEqual(existingValue, entry.value);
			const status = valuesMatch
				? 'unchanged'
				: hasExistingValue
					? overwrite
						? 'overwritten'
						: 'conflict'
					: 'added';

			changes.push({
				...(hasExistingValue ? { existingValue } : {}),
				incomingValue: entry.value,
				key: entry.key,
				source: entry.source,
				status,
			});

			if (status === 'added' || status === 'overwritten') {
				setValueAtPath(resultingConfig, entry.key, entry.value);
			}
		}
	}

	if (targetIsInvalid) {
		diagnostics.push({
			code: 'migration-target-invalid',
			message:
				'ensemble.json is invalid, so migration cannot safely merge settings.',
			severity: 'error',
		});
	}

	return {
		canApply:
			!targetIsInvalid &&
			changes.some(
				(change) =>
					change.status === 'added' || change.status === 'overwritten',
			),
		changes,
		diagnostics,
		repositoryPath,
		resultingConfig,
		sourcePath,
		targetExists: target.status !== 'missing',
		targetPath,
	};
}

/**
 * Writes the migrated `ensemble.json` to disk after computing a preview, leaving
 * the file untouched when the preview indicates the change is unsafe.
 * @param request - Migration request (path + overwrite flag).
 * @returns The applied result, including any write error.
 */
export function applyRepositoryConfigMigration(
	request: RepositoryConfigMigrationRequest,
): RepositoryConfigMigrationResult {
	const preview = previewRepositoryConfigMigration(request);

	if (!preview.canApply) {
		return {
			...preview,
			applied: false,
		};
	}

	try {
		mkdirSync(path.dirname(preview.targetPath), { recursive: true });
		writeFileSync(
			preview.targetPath,
			`${JSON.stringify(preview.resultingConfig, null, '\t')}\n`,
		);

		return {
			...preview,
			applied: true,
			targetExists: true,
		};
	} catch (error) {
		return {
			...preview,
			applied: false,
			error: formatErrorMessage(
				error,
				'Failed to write migrated ensemble.json.',
			),
		};
	}
}

/**
 * Builds an empty preview used for early-return error cases.
 */
function createEmptyMigrationPreview({
	diagnostics,
	repositoryPath,
}: {
	diagnostics: ConfigDiagnostic[];
	repositoryPath: string;
}): RepositoryConfigMigrationPreview {
	return {
		canApply: false,
		changes: [],
		diagnostics,
		repositoryPath,
		resultingConfig: {},
		sourcePath: null,
		targetExists: false,
		targetPath: repositoryPath
			? path.join(repositoryPath, ENSEMBLE_CONFIG_FILENAME)
			: '',
	};
}

/**
 * Picks the highest-priority Conductor source eligible for migration into
 * ensemble.json.
 */
function getMigrationSource(
	sources: readonly RepositoryConfigSourceSnapshot[],
): RepositoryConfigSourceSnapshot | null {
	return (
		sources.find(
			(source) =>
				source.source === 'conductor-config' && source.status === 'loaded',
		) ??
		sources.find(
			(source) =>
				source.source === 'conductor-legacy-config' &&
				source.status === 'loaded',
		) ??
		null
	);
}

/**
 * Flattens Conductor settings into the migration entries written into
 * `ensemble.json`, expanding `scripts.*` keys and excluding compat flags.
 */
function collectMigrationEntries(
	settings: Record<string, unknown>,
	source: SettingsResolutionSource,
): MigrationEntry[] {
	const entries: MigrationEntry[] = [];

	if (isPlainRecord(settings.scripts)) {
		for (const key of ['setup', 'run', 'archive']) {
			if (settings.scripts[key] !== undefined) {
				entries.push({
					key: `scripts.${key}`,
					source,
					value: settings.scripts[key],
				});
			}
		}
	}

	for (const [key, value] of Object.entries(settings)) {
		if (key === 'scripts' || key === 'conductorCompatibility') {
			continue;
		}

		entries.push({ key, source, value });
	}

	return entries.sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * Walks a dotted path inside a record, reporting whether a value exists at the
 * leaf and what it currently is.
 */
function inspectValueAtPath(
	record: Record<string, unknown>,
	fieldPath: string,
): {
	existingValue?: unknown;
	hasExistingValue: boolean;
} {
	const [head, ...tail] = fieldPath.split('.');

	if (!head || !Object.hasOwn(record, head)) {
		return { hasExistingValue: false };
	}

	let current: unknown = record[head];

	for (const part of tail) {
		if (!isPlainRecord(current)) {
			return { existingValue: current, hasExistingValue: true };
		}

		if (!Object.hasOwn(current, part)) {
			return { hasExistingValue: false };
		}

		current = current[part];
	}

	return { existingValue: current, hasExistingValue: true };
}

/**
 * Sets a dotted-path value inside a record, creating intermediate objects when
 * they are missing or shadowing non-object values.
 */
function setValueAtPath(
	record: Record<string, unknown>,
	fieldPath: string,
	value: unknown,
): void {
	const [head, ...tail] = fieldPath.split('.');

	if (!head) {
		return;
	}

	if (tail.length === 0) {
		record[head] = value;
		return;
	}

	const existingHead = record[head];

	if (!isPlainRecord(existingHead)) {
		record[head] = {};
	}

	let current = record[head] as Record<string, unknown>;

	for (const part of tail.slice(0, -1)) {
		const existing = current[part];

		if (!isPlainRecord(existing)) {
			current[part] = {};
		}

		current = current[part] as Record<string, unknown>;
	}

	const leaf = tail.at(-1);

	if (leaf) {
		current[leaf] = value;
	}
}
