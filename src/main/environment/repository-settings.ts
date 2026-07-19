import type { DatabaseSync } from 'node:sqlite';

import type { RepositorySettingsPatch } from '../../shared/ipc/contracts/repository-settings.ts';
import { withTransaction } from '../storage/tx.ts';
import type { NormalizedScope } from './environment-variable-types.ts';
import { deleteSetting, upsertSetting } from './settings-table.ts';

/** Database handle plus the repository whose personal settings are being written. */
interface UpsertRepositorySettingsInput {
	database: DatabaseSync;
	repositoryId: string;
	settings: RepositorySettingsPatch;
}

/**
 * Persists a repository's personal settings patch as repository-scoped SQLite
 * rows the settings resolver reads verbatim (`branchFrom`, `remoteOrigin`,
 * `deleteLocalBranchOnArchive`, `archiveAfterMerge`, `filesToCopy`,
 * `previewUrls`). An omitted field is left untouched; an explicit `null` (or a
 * blank string / empty list) deletes its row so the value falls back to
 * `.ensemblr/settings.toml`, user defaults, then the built-in default. All rows
 * are written in a single transaction so a mid-sequence failure rolls back
 * cleanly instead of leaving the settings half-written.
 * @param input - Database handle, repository id, and the patch to apply.
 */
export function upsertRepositorySettings({
	database,
	repositoryId,
	settings,
}: UpsertRepositorySettingsInput): void {
	const scope: NormalizedScope = { scope: 'repository', scopeId: repositoryId };

	withTransaction(database, () => {
		setStringSetting({
			database,
			key: 'branchFrom',
			scope,
			value: settings.branchFrom,
		});
		setStringSetting({
			database,
			key: 'remoteOrigin',
			scope,
			value: settings.remoteOrigin,
		});
		setBooleanSetting({
			database,
			key: 'deleteLocalBranchOnArchive',
			scope,
			value: settings.deleteLocalBranchOnArchive,
		});
		setBooleanSetting({
			database,
			key: 'archiveAfterMerge',
			scope,
			value: settings.archiveAfterMerge,
		});
		setListSetting({
			database,
			key: 'filesToCopy',
			scope,
			value: settings.filesToCopy,
		});
		setListSetting({
			database,
			key: 'previewUrls',
			scope,
			value: settings.previewUrls,
		});
	});
}

/**
 * Upserts a string setting row, or deletes it when the value is `null`/blank so
 * the key falls back to the next resolver source. `undefined` leaves the row
 * untouched.
 */
function setStringSetting({
	database,
	key,
	scope,
	value,
}: {
	database: DatabaseSync;
	key: string;
	scope: NormalizedScope;
	value: string | null | undefined;
}): void {
	if (value === undefined) {
		return;
	}

	const trimmed = value?.trim() ?? '';

	if (!trimmed) {
		deleteSetting({ database, key, scope });
		return;
	}

	upsertSetting({ database, key, scope, valueJson: JSON.stringify(trimmed) });
}

/**
 * Upserts a boolean setting row, or deletes it when the value is `null` so the
 * key falls back to the next resolver source. `undefined` leaves the row
 * untouched; `false` is a real stored value, not a clear.
 */
function setBooleanSetting({
	database,
	key,
	scope,
	value,
}: {
	database: DatabaseSync;
	key: string;
	scope: NormalizedScope;
	value: boolean | null | undefined;
}): void {
	if (value === undefined) {
		return;
	}

	if (value === null) {
		deleteSetting({ database, key, scope });
		return;
	}

	upsertSetting({ database, key, scope, valueJson: JSON.stringify(value) });
}

/**
 * Upserts a list setting row, or deletes it when the value is `null`/empty so
 * the key falls back to the next resolver source. `undefined` leaves the row
 * untouched.
 */
function setListSetting<T>({
	database,
	key,
	scope,
	value,
}: {
	database: DatabaseSync;
	key: string;
	scope: NormalizedScope;
	value: T[] | null | undefined;
}): void {
	if (value === undefined) {
		return;
	}

	if (value === null || value.length === 0) {
		deleteSetting({ database, key, scope });
		return;
	}

	upsertSetting({ database, key, scope, valueJson: JSON.stringify(value) });
}
