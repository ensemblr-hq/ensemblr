import type { DatabaseSync } from 'node:sqlite';

/**
 * Runs `fn` inside a synchronous SQLite transaction.
 *
 * Opens a `BEGIN`, commits on success, rolls back on throw. The thrown error
 * is rethrown unchanged so callers can keep their existing error paths.
 *
 * @param database - Open SQLite connection.
 * @param fn - Synchronous unit of work. Its return value becomes the result.
 * @returns Whatever `fn` returns.
 */
export function withTransaction<T>(database: DatabaseSync, fn: () => T): T {
	database.exec('BEGIN');
	try {
		const result = fn();
		database.exec('COMMIT');
		return result;
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}
