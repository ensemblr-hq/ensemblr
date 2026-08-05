import type { DatabaseSync } from 'node:sqlite';

import type {
	RunScriptMode,
	WorkspaceRunTargetInput,
} from '../../shared/scripts.ts';
import { withTransaction } from '../storage/tx.ts';
import type { NormalizedScope } from './environment-variable-types.ts';
import { deleteSetting, upsertSetting } from './settings-table.ts';

/** Persisted fields for a repository's Scripts settings screen. */
interface UpsertRepositoryScriptSettingsInput {
	archive: string | null;
	autoRunAfterSetup: boolean;
	database: DatabaseSync;
	repositoryId: string;
	/** Empty array clears the stored row, same as a blank command did before. */
	run: WorkspaceRunTargetInput[] | null;
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
		setRunTargets({ database, run, scope });
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
 * Upserts the `scripts.run` row as a JSON array of run targets, or deletes it
 * when the list is empty so the key falls back to `.ensemblr/settings.toml` /
 * built-in defaults. Blank-command entries are dropped; blank names are kept
 * (they render as the unnamed "Run" target).
 */
function setRunTargets({
	database,
	run,
	scope,
}: {
	database: DatabaseSync;
	run: WorkspaceRunTargetInput[] | null;
	scope: NormalizedScope;
}): void {
	const targets = (run ?? []).filter((target) => target.command.trim());

	if (targets.length === 0) {
		deleteSetting({ database, key: 'scripts.run', scope });
		return;
	}

	upsertSetting({
		database,
		key: 'scripts.run',
		scope,
		valueJson: JSON.stringify(targets),
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
