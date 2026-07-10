import type { DatabaseSync } from 'node:sqlite';

import type { RunScriptMode } from '../../shared/scripts/script-settings.ts';
import { withTransaction } from '../storage/tx.ts';
import type { NormalizedScope } from './environment-variable-types.ts';
import { deleteSetting, upsertSetting } from './settings-table.ts';

/** Persisted fields for a repository's Scripts settings screen. */
export interface UpsertRepositoryScriptSettingsInput {
	archive: string | null;
	autoRunAfterSetup: boolean;
	database: DatabaseSync;
	repositoryId: string;
	run: string | null;
	runScriptMode: RunScriptMode;
	setup: string | null;
}

/**
 * Persists the Scripts settings screen edits as repository-scoped SQLite rows
 * the settings resolver reads directly. Uses the resolver's raw keys
 * (`scripts.setup`/`scripts.run`/`scripts.archive`/`runScriptMode`/
 * `autoRunAfterSetup`) — the keys are NOT run through `toSettingKey` because the
 * resolver matches them verbatim. A blank script command deletes its row so the
 * value falls back to `.ensemblr/settings.toml` / built-in defaults. All rows
 * are written in a single SQLite transaction so a mid-sequence failure rolls
 * back cleanly instead of leaving the settings half-written.
 * @param input - Database handle, repository id, and the edited fields.
 */
export function upsertRepositoryScriptSettings({
	archive,
	autoRunAfterSetup,
	database,
	repositoryId,
	run,
	runScriptMode,
	setup,
}: UpsertRepositoryScriptSettingsInput): void {
	const scope: NormalizedScope = { scope: 'repository', scopeId: repositoryId };

	// Persist every key atomically: a mid-sequence throw rolls the whole write
	// back instead of leaving the Scripts settings partially applied.
	withTransaction(database, () => {
		setScriptCommand({ database, key: 'scripts.setup', scope, value: setup });
		setScriptCommand({ database, key: 'scripts.run', scope, value: run });
		setScriptCommand({
			database,
			key: 'scripts.archive',
			scope,
			value: archive,
		});

		upsertSetting({
			database,
			key: 'runScriptMode',
			scope,
			valueJson: JSON.stringify(runScriptMode),
		});
		upsertSetting({
			database,
			key: 'autoRunAfterSetup',
			scope,
			valueJson: JSON.stringify(autoRunAfterSetup),
		});
	});
}

/**
 * Upserts a script command row, or deletes it when the command is blank so the
 * key falls back to the next source in the resolver.
 */
function setScriptCommand({
	database,
	key,
	scope,
	value,
}: {
	database: DatabaseSync;
	key: string;
	scope: NormalizedScope;
	value: string | null;
}): void {
	const trimmed = value?.trim() ?? '';

	if (!trimmed) {
		deleteSetting({ database, key, scope });
		return;
	}

	upsertSetting({ database, key, scope, valueJson: JSON.stringify(trimmed) });
}
