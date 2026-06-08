import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';

import type {
	RootDirectoryChangeApplyResult,
	RootDirectoryChangePreview,
	RootDirectoryDiagnostic,
	RootDirectoryReconciliationSnapshot,
	RootDirectorySnapshot,
	SettingsResolutionSnapshot,
} from '../../shared/ipc';
import {
	ensureRootDirectory,
	findRootDirectorySetting,
	inspectRootPathValue,
	ROOT_DIRECTORY_KEY,
} from './root-directory.ts';

/** Hook used to scan and reconcile a root directory after a change. */
export type RootDirectoryReconciler = (options: {
	now?: () => Date;
	root: RootDirectorySnapshot;
}) => RootDirectoryReconciliationSnapshot;

/**
 * Computes a non-destructive preview of a root-directory change, reporting
 * blockers such as the setting being locked or the candidate path being invalid.
 * @param input - Candidate path, previous root, and current settings snapshot.
 * @returns A {@link RootDirectoryChangePreview}.
 */
export function previewRootDirectoryChange({
	homeDirectory = homedir(),
	nextRootPath,
	previousRoot,
	settingsSnapshot,
}: {
	homeDirectory?: string;
	nextRootPath: string;
	previousRoot: RootDirectorySnapshot | null;
	settingsSnapshot: SettingsResolutionSnapshot;
}): RootDirectoryChangePreview {
	const diagnostics: RootDirectoryDiagnostic[] = [];
	const currentSetting = findRootDirectorySetting(settingsSnapshot);
	const newRoot = inspectRootPathValue({
		allowCreate: false,
		homeDirectory,
		missingManagedDirectorySeverity: 'info',
		rootPathValue: nextRootPath,
	});

	if (currentSetting?.locked) {
		diagnostics.push({
			code: 'root-setting-locked',
			message:
				'The rootDirectory setting is locked by managed config and cannot be changed here.',
			severity: 'error',
		});
	}

	diagnostics.push(...newRoot.diagnostics);

	return {
		canApply: !diagnostics.some(
			(diagnostic) => diagnostic.severity === 'error',
		),
		diagnostics,
		newRoot,
		oldRoot: previousRoot,
		oldRootPreserved: true,
	};
}

/**
 * Persists a root-directory change after preview validation, then re-runs
 * `ensureRootDirectory` and reconciliation against the new root.
 * @param input - Database, new path, previous root, settings refresher, reconciler.
 * @returns A {@link RootDirectoryChangeApplyResult}.
 */
export function applyRootDirectoryChange({
	database,
	homeDirectory = homedir(),
	nextRootPath,
	now = () => new Date(),
	previousRoot,
	reconcileRootDirectory = createEmptyRootDirectoryReconciliation,
	resolveSettingsSnapshot,
}: {
	database: DatabaseSync | null;
	homeDirectory?: string;
	nextRootPath: string;
	now?: () => Date;
	previousRoot: RootDirectorySnapshot | null;
	reconcileRootDirectory?: RootDirectoryReconciler;
	resolveSettingsSnapshot: () => SettingsResolutionSnapshot;
}): RootDirectoryChangeApplyResult {
	const currentSettings = resolveSettingsSnapshot();
	const preview = previewRootDirectoryChange({
		homeDirectory,
		nextRootPath,
		previousRoot,
		settingsSnapshot: currentSettings,
	});

	if (!preview.canApply) {
		return {
			applied: false,
			error:
				preview.diagnostics.find(
					(diagnostic) => diagnostic.severity === 'error',
				)?.message ?? 'The selected root directory cannot be applied.',
			newRoot: preview.newRoot,
			oldRoot: previousRoot,
			oldRootPreserved: true,
			reconciliation: null,
		};
	}

	if (!database) {
		return {
			applied: false,
			error: 'SQLite is unavailable; the root directory change was not saved.',
			newRoot: preview.newRoot,
			oldRoot: previousRoot,
			oldRootPreserved: true,
			reconciliation: null,
		};
	}

	try {
		saveRootDirectoryOverride({
			database,
			now,
			rootPath: preview.newRoot.path,
		});
	} catch (error) {
		return {
			applied: false,
			error:
				error instanceof Error
					? error.message
					: 'The root directory change was not saved.',
			newRoot: preview.newRoot,
			oldRoot: previousRoot,
			oldRootPreserved: true,
			reconciliation: null,
		};
	}

	const newRoot = ensureRootDirectory({
		allowCreate: true,
		database,
		homeDirectory,
		now,
		settingsSnapshot: resolveSettingsSnapshot(),
	});
	const reconciliation = reconcileRootDirectory({ now, root: newRoot });

	return {
		applied: true,
		error:
			newRoot.status === 'error'
				? (newRoot.diagnostics.find(
						(diagnostic) => diagnostic.severity === 'error',
					)?.message ?? 'The root directory change was saved but setup failed.')
				: undefined,
		newRoot,
		oldRoot: previousRoot,
		oldRootPreserved: true,
		reconciliation,
	};
}

/** No-op reconciler used when no full scanner is wired up. */
function createEmptyRootDirectoryReconciliation({
	now = () => new Date(),
	root,
}: {
	now?: () => Date;
	root: RootDirectorySnapshot;
}): RootDirectoryReconciliationSnapshot {
	return {
		diagnostics: root.status === 'error' ? root.diagnostics : [],
		repositoryDirectoryCount: 0,
		scannedAt: now().toISOString(),
		status:
			root.status === 'error'
				? 'error'
				: root.status === 'warning'
					? 'warning'
					: 'ok',
		workspaceDirectoryCount: 0,
	};
}

/**
 * Persists the user's `rootDirectory` override into the SQLite `settings` table.
 */
function saveRootDirectoryOverride({
	database,
	now,
	rootPath,
}: {
	database: DatabaseSync;
	now: () => Date;
	rootPath: string;
}): void {
	const timestamp = now().toISOString();

	database
		.prepare(
			`INSERT INTO settings (
				id,
				scope,
				scope_id,
				key,
				value_json,
				source,
				locked,
				updated_at
			)
			VALUES (?, 'app', '', ?, ?, 'sqlite', 0, ?)
			ON CONFLICT(scope, scope_id, key) DO UPDATE SET
				value_json = excluded.value_json,
				source = 'sqlite',
				locked = 0,
				updated_at = excluded.updated_at`,
		)
		.run(
			`setting-${randomUUID()}`,
			ROOT_DIRECTORY_KEY,
			JSON.stringify(rootPath),
			timestamp,
		);
}
