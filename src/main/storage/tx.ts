import type { DatabaseSync } from 'node:sqlite';

/**
 * Runs `fn` inside a synchronous SQLite transaction.
 *
 * Opens a `BEGIN IMMEDIATE`, commits on success, rolls back on throw. The
 * thrown error is rethrown unchanged so callers can keep their existing error
 * paths.
 *
 * `IMMEDIATE` matches every repository-internal transaction, and it is
 * load-bearing rather than cosmetic: a deferred transaction that reads before
 * it writes has to promote its lock, and under WAL a snapshot another
 * connection has moved past fails that promotion with `SQLITE_BUSY_SNAPSHOT`
 * immediately — `busy_timeout` does not apply to a promotion. Dev builds are
 * excluded from the single-instance lock and share one database file, so two
 * dogfooding instances are exactly that case. The rollback is guarded because
 * SQLite may already have rolled the transaction back itself (an I/O error, a
 * full disk), in which case `ROLLBACK` throws and would replace the real cause.
 *
 * @param database - Open SQLite connection.
 * @param fn - Synchronous unit of work. Its return value becomes the result.
 * @returns Whatever `fn` returns.
 */
export function withTransaction<T>(database: DatabaseSync, fn: () => T): T {
	database.exec('BEGIN IMMEDIATE');
	try {
		const result = fn();
		database.exec('COMMIT');
		return result;
	} catch (error) {
		rollbackQuietly(database);
		throw error;
	}
}

/**
 * Rolls a failed transaction back without replacing the error that caused it.
 *
 * SQLite rolls a transaction back itself on an I/O error or a full disk, and a
 * `ROLLBACK` issued after that throws "cannot rollback — no transaction is
 * active". Raised from a `catch` block, that secondary error propagates in
 * place of the real cause.
 * @param database - Open SQLite connection.
 */
export function rollbackQuietly(database: DatabaseSync): void {
	try {
		database.exec('ROLLBACK');
	} catch {}
}
