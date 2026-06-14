import type { DatabaseSync } from 'node:sqlite';

import type { ResolvedSettingSnapshot, SettingsResolutionSource } from '../../shared/ipc/contracts/settings-resolution';
import type { RootDirectoryDiagnostic, RootDirectoryManagedPathSnapshot, RootDirectorySnapshot } from '../../shared/ipc/contracts/root-directory';

const CURRENT_ROOT_ID = 'current';

/**
 * Assembles the final {@link RootDirectorySnapshot} including derived managed
 * paths and the overall status computed from diagnostics.
 * @param input - Snapshot fields.
 * @returns A {@link RootDirectorySnapshot}.
 */
export function buildRootDirectorySnapshot({
	createdPaths,
	diagnostics,
	managedPaths,
	rootPath,
	setting,
	source,
}: {
	createdPaths: string[];
	diagnostics: RootDirectoryDiagnostic[];
	managedPaths: RootDirectoryManagedPathSnapshot[];
	rootPath: string;
	setting: ResolvedSettingSnapshot | null;
	source: SettingsResolutionSource | null;
}): RootDirectorySnapshot {
	const status = diagnostics.some(
		(diagnostic) => diagnostic.severity === 'error',
	)
		? 'error'
		: diagnostics.some((diagnostic) => diagnostic.severity === 'warning')
			? 'warning'
			: 'ok';
	const managedPathByKey = new Map(
		managedPaths.map((managedPath) => [managedPath.key, managedPath.path]),
	);

	return {
		archivedContextsPath: managedPathByKey.get('archived-contexts') ?? '',
		createdPaths,
		diagnostics,
		managedPaths,
		path: rootPath,
		repositoriesPath: managedPathByKey.get('repos') ?? '',
		setting,
		source,
		status,
		workspacesPath: managedPathByKey.get('workspaces') ?? '',
	};
}

/**
 * Upserts the current root snapshot into the `root_directories` table.
 * @param database - Open SQLite connection or `null`.
 * @param snapshot - Snapshot to persist.
 * @param now - Clock injection point.
 */
export function persistRootDirectorySnapshot(
	database: DatabaseSync | null,
	snapshot: RootDirectorySnapshot,
	now: () => Date,
): void {
	if (!database || !snapshot.path || !snapshot.source) {
		return;
	}

	const timestamp = now().toISOString();

	database
		.prepare(
			`INSERT INTO root_directories (
				id,
				path,
				source,
				status,
				repositories_path,
				workspaces_path,
				archived_contexts_path,
				last_seen_at,
				metadata_json
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				path = excluded.path,
				source = excluded.source,
				status = excluded.status,
				repositories_path = excluded.repositories_path,
				workspaces_path = excluded.workspaces_path,
				archived_contexts_path = excluded.archived_contexts_path,
				last_seen_at = excluded.last_seen_at,
				metadata_json = excluded.metadata_json`,
		)
		.run(
			CURRENT_ROOT_ID,
			snapshot.path,
			snapshot.source,
			snapshot.status,
			snapshot.repositoriesPath,
			snapshot.workspacesPath,
			snapshot.archivedContextsPath,
			timestamp,
			JSON.stringify({
				createdPaths: snapshot.createdPaths,
				diagnostics: snapshot.diagnostics,
				managedPaths: snapshot.managedPaths,
				setting: snapshot.setting
					? {
							candidates: snapshot.setting.candidates,
							locked: snapshot.setting.locked,
							source: snapshot.setting.source,
						}
					: null,
			}),
		);
}
