import type { DatabaseSync } from 'node:sqlite';

/** The managed roots a recursive removal has to stay inside. */
export interface ManagedRoots {
	archivedContextsPath: string;
	workspacesPath: string;
}

/**
 * Reads the managed roots straight from the persisted root-directory record.
 *
 * `EnsemblrRootDirectoryService` is the canonical source, but it is injected
 * into only a few of the services that remove directories; every one of them
 * already holds the database the service writes that snapshot to, so reading
 * the row is what lets a containment check reach the call sites that have no
 * root service in scope.
 * @param database - Open connection, or null when the database is unavailable.
 * @returns The managed roots, or null when no root has been resolved yet.
 */
export function readManagedRoots(
	database: DatabaseSync | null,
): ManagedRoots | null {
	if (!database) {
		return null;
	}

	const row = database
		.prepare(
			`SELECT workspaces_path, archived_contexts_path
			 FROM root_directories
			 WHERE id = 'current'`,
		)
		.get() as
		| { archived_contexts_path: string; workspaces_path: string }
		| undefined;

	if (!row?.workspaces_path) {
		return null;
	}

	return {
		archivedContextsPath: row.archived_contexts_path,
		workspacesPath: row.workspaces_path,
	};
}
