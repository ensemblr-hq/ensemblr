import type { DatabaseSync } from 'node:sqlite';

import { rollbackQuietly } from '../tx.ts';

/**
 * Days a closed session's transcript is kept before its events are dropped.
 *
 * Neither fork nor resume replays the event log — a fork summarizes through
 * `writeForkSummary` and a resume reattaches by `runtimeSessionId` — so history
 * is scroll-back, not correctness.
 */
export const EVENT_RETENTION_DAYS = 30;

/**
 * Events kept per branch regardless of age. Nine days of one developer's use
 * put 890,305 rows and 732 MB of table in `agent_session_events`, 94% of a
 * 989 MB file, with no pruning path anywhere in the app.
 */
export const MAX_EVENTS_PER_BRANCH = 500;

/** Rows each sweep deleted, per table and per rule. */
export interface EventRetentionResult {
	agentByAge: number;
	agentByTail: number;
	conciergeByAge: number;
	conciergeByTail: number;
}

/** Options for {@link pruneAgentEventHistory}; tests override the clock and caps. */
export interface PruneEventHistoryOptions {
	database: DatabaseSync;
	maxEventsPerBranch?: number;
	now?: Date;
	retentionDays?: number;
}

const DELETE_AGENT_EVENTS_BY_AGE = `DELETE FROM agent_session_events
WHERE branch_id IN (
	SELECT branches.id
	FROM agent_session_branches AS branches
	JOIN agent_sessions AS sessions ON sessions.id = branches.agent_session_id
	WHERE sessions.closed_at IS NOT NULL AND sessions.closed_at < ?
)`;

const DELETE_AGENT_EVENTS_BY_TAIL = `DELETE FROM agent_session_events
WHERE ordinal <= (
	SELECT MAX(newest.ordinal) - ?
	FROM agent_session_events AS newest
	WHERE newest.branch_id = agent_session_events.branch_id
)`;

const DELETE_CONCIERGE_EVENTS_BY_AGE = `DELETE FROM concierge_session_events
WHERE session_id IN (
	SELECT id FROM concierge_sessions
	WHERE closed_at IS NOT NULL AND closed_at < ?
)`;

const DELETE_CONCIERGE_EVENTS_BY_TAIL = `DELETE FROM concierge_session_events
WHERE ordinal <= (
	SELECT MAX(newest.ordinal) - ?
	FROM concierge_session_events AS newest
	WHERE newest.session_id = concierge_session_events.session_id
)`;

/**
 * ISO instant the age rule cuts at.
 * @param now - Current time.
 * @param retentionDays - Days of closed-session history to keep.
 * @returns The cutoff as an ISO 8601 string, matching the stored format.
 */
function retentionCutoff(now: Date, retentionDays: number): string {
	return new Date(
		now.getTime() - retentionDays * 24 * 60 * 60 * 1000,
	).toISOString();
}

/**
 * Runs one statement and reports how many rows it removed.
 * @param database - Open SQLite connection.
 * @param sql - The `DELETE` to run.
 * @param bound - Its single bound parameter.
 * @returns Rows deleted.
 */
function deleteRows(
	database: DatabaseSync,
	sql: string,
	bound: number | string,
): number {
	return Number(database.prepare(sql).run(bound).changes ?? 0);
}

/**
 * Whether a table exists on this connection. The sweep runs at open, ahead of
 * every other subsystem, so a schema that predates one of the two transcript
 * tables must leave it alone rather than fail the launch.
 * @param database - Open SQLite connection.
 * @param table - Table name to look for.
 * @returns True when the table is present.
 */
function hasTable(database: DatabaseSync, table: string): boolean {
	return (
		database
			.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
			)
			.get(table) !== undefined
	);
}

/**
 * Prunes agent and Concierge transcripts to the retention policy: a closed
 * session's events go once it has been closed longer than the retention
 * window, and every branch keeps at most its newest `maxEventsPerBranch`
 * events.
 *
 * Runs in one transaction so a failure mid-sweep leaves the log as it was. The
 * freed pages go on SQLite's freelist and are reused by later appends; the file
 * itself only shrinks under an explicit `VACUUM`.
 * @param options - Database, and optional clock and cap overrides.
 * @returns Rows deleted per table and rule.
 */
export function pruneAgentEventHistory({
	database,
	maxEventsPerBranch = MAX_EVENTS_PER_BRANCH,
	now = new Date(),
	retentionDays = EVENT_RETENTION_DAYS,
}: PruneEventHistoryOptions): EventRetentionResult {
	const cutoff = retentionCutoff(now, retentionDays);
	const sweepsAgent = hasTable(database, 'agent_session_events');
	const sweepsConcierge = hasTable(database, 'concierge_session_events');

	database.exec('BEGIN IMMEDIATE');
	try {
		const result: EventRetentionResult = {
			agentByAge: sweepsAgent
				? deleteRows(database, DELETE_AGENT_EVENTS_BY_AGE, cutoff)
				: 0,
			agentByTail: sweepsAgent
				? deleteRows(database, DELETE_AGENT_EVENTS_BY_TAIL, maxEventsPerBranch)
				: 0,
			conciergeByAge: sweepsConcierge
				? deleteRows(database, DELETE_CONCIERGE_EVENTS_BY_AGE, cutoff)
				: 0,
			conciergeByTail: sweepsConcierge
				? deleteRows(
						database,
						DELETE_CONCIERGE_EVENTS_BY_TAIL,
						maxEventsPerBranch,
					)
				: 0,
		};
		database.exec('COMMIT');
		return result;
	} catch (error) {
		rollbackQuietly(database);
		throw error;
	}
}
