import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Sentinel filename Ensemblr writes inside a repository folder when the user
 * archives the project. The shared-root reconciler treats any folder
 * containing this file as intentionally hidden and skips it during auto-
 * adoption — without this, app restart would re-discover the still-on-disk
 * folder and resurrect the row the user just deleted.
 */
export const ARCHIVED_REPOSITORY_MARKER = '.ensemblr-archived';

/** True when `repositoryPath` holds the archived-repository sentinel. */
export function hasArchivedRepositoryMarker(repositoryPath: string): boolean {
	return existsSync(path.join(repositoryPath, ARCHIVED_REPOSITORY_MARKER));
}
