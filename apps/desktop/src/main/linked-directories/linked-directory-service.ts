import { stat } from 'node:fs/promises';
import path from 'node:path';

import type {
	LinkedDirectoryRecentWire,
	LinkedDirectoryRequest,
	ListLinkedDirectoryRecentsResult,
	RecordLinkedDirectoryResult,
} from '../../shared/ipc/contracts/linked-directories.ts';
import type { EnsemblrDatabaseService } from '../storage/index.ts';
import type { LinkedDirectoryRecentRow } from '../storage/repositories/linked-directory-repository.ts';
import {
	readLinkedDirectoryRecents,
	writeLinkedDirectoryRecents,
} from '../storage/repositories/linked-directory-repository.ts';
import {
	dropLinkedDirectoryRecent,
	mergeLinkedDirectoryRecent,
} from './linked-directory-recents.ts';

/** Reads and mutates the app-global list of directories the user has linked. */
export interface LinkedDirectoryService {
	forget: (
		request: LinkedDirectoryRequest,
	) => Promise<ListLinkedDirectoryRecentsResult>;
	list: () => Promise<ListLinkedDirectoryRecentsResult>;
	record: (
		request: LinkedDirectoryRequest,
	) => Promise<RecordLinkedDirectoryResult>;
}

/**
 * Resolves whether a stored path still names a directory today.
 * @param entry - One persisted recents row.
 * @returns The row widened with its current existence.
 */
async function toWire(
	entry: LinkedDirectoryRecentRow,
): Promise<LinkedDirectoryRecentWire> {
	try {
		const stats = await stat(entry.path);
		return { ...entry, exists: stats.isDirectory() };
	} catch {
		return { ...entry, exists: false };
	}
}

/**
 * Builds the service that backs the composer's directory picker: an app-global,
 * project-agnostic recents list stored in the SQLite `settings` table.
 *
 * Paths are normalised before they are stored, so the same folder reached by two
 * spellings occupies one row. Symlinks are deliberately NOT resolved: the path
 * the user picked is the one the agent is granted and the one the chip shows,
 * and silently rewriting it to a link target would grant access to somewhere
 * they never named.
 * @param databaseService - Holder of the open SQLite connection.
 * @returns The linked-directory service.
 */
export function createLinkedDirectoryService({
	databaseService,
}: {
	databaseService: EnsemblrDatabaseService;
}): LinkedDirectoryService {
	/**
	 * Reads persisted rows, or an empty list when the database is unavailable.
	 * @returns The stored entries, newest first.
	 */
	const readRows = (): readonly LinkedDirectoryRecentRow[] => {
		const connection = databaseService.getConnection();
		return connection ? readLinkedDirectoryRecents(connection.database) : [];
	};

	/**
	 * Persists rows, doing nothing when the database is unavailable.
	 * @param entries - The list to store, newest first.
	 */
	const writeRows = (entries: readonly LinkedDirectoryRecentRow[]): void => {
		const connection = databaseService.getConnection();
		if (connection) {
			writeLinkedDirectoryRecents({ database: connection.database, entries });
		}
	};

	/**
	 * Widens every stored row with its current existence.
	 * @param entries - The stored entries.
	 * @returns The renderer-facing list.
	 */
	const resolveEntries = (
		entries: readonly LinkedDirectoryRecentRow[],
	): Promise<LinkedDirectoryRecentWire[]> =>
		Promise.all(entries.map((entry) => toWire(entry)));

	return {
		forget: async ({ path: target }) => {
			const remaining = dropLinkedDirectoryRecent(
				readRows(),
				path.normalize(target),
			);
			writeRows(remaining);
			return { entries: await resolveEntries(remaining) };
		},

		list: async () => ({ entries: await resolveEntries(readRows()) }),

		record: async ({ path: target }) => {
			const trimmed = target.trim();
			if (trimmed.length === 0 || !path.isAbsolute(trimmed)) {
				return {
					entries: await resolveEntries(readRows()),
					error: {
						code: 'invalid-path',
						message: 'A linked directory needs an absolute path.',
					},
				};
			}

			const normalized = path.normalize(trimmed);
			try {
				const stats = await stat(normalized);
				if (!stats.isDirectory()) {
					return {
						entries: await resolveEntries(readRows()),
						error: {
							code: 'not-a-directory',
							message: `${normalized} is not a directory.`,
						},
					};
				}
			} catch (cause) {
				return {
					entries: await resolveEntries(readRows()),
					error: {
						code: 'read-failed',
						message:
							cause instanceof Error
								? cause.message
								: `Could not read ${normalized}.`,
					},
				};
			}

			const entry: LinkedDirectoryRecentRow = {
				lastUsedAt: new Date().toISOString(),
				name: path.basename(normalized) || normalized,
				path: normalized,
			};
			const merged = mergeLinkedDirectoryRecent(readRows(), entry);
			writeRows(merged);
			return {
				directory: { ...entry, exists: true },
				entries: await resolveEntries(merged),
			};
		},
	};
}
