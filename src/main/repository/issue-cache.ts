import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { RepositoryIssueWire } from '../../shared/ipc/contracts/workspace-sources';

const PROVIDER = 'github';
const RESOURCE_TYPE = 'issue-list';
const UNASSIGNED_RESOURCE_TYPE = 'issue-list-unassigned';
const ISSUE_STRING_FIELDS = [
	'body',
	'state',
	'title',
	'updatedAt',
	'url',
] as const satisfies readonly (keyof RepositoryIssueWire)[];
const ISSUE_ARRAY_FIELDS = [
	'assigneeLogins',
	'labels',
] as const satisfies readonly (keyof RepositoryIssueWire)[];

/**
 * A repository's issue list as `gh` last returned it. GitHub stays the source of
 * truth — the cache exists so the dashboard board paints from SQLite instead of
 * waiting on a `gh issue list` per repository at every app start.
 */
export interface CachedRepositoryIssues {
	issues: RepositoryIssueWire[];
	/** When the rows were read from GitHub, as an ISO timestamp. */
	syncedAt: string;
}

/**
 * Names the cache row for a list variant. The board asks GitHub for unassigned
 * issues only, so its rows are a different list from the pickers' and cannot
 * share a row — one would serve the other a silently truncated answer.
 * @param unassignedOnly - Whether the row holds the unassigned-only list.
 * @returns The `resource_type` the row is stored under.
 */
function resourceTypeFor(unassignedOnly: boolean): string {
	return unassignedOnly ? UNASSIGNED_RESOURCE_TYPE : RESOURCE_TYPE;
}

/**
 * Narrows one parsed element to an issue, so a row written by an older build
 * cannot reach the renderer missing a field the board dereferences.
 * @param value - One element of the parsed `issues` array.
 * @returns True when the element carries every field the wire type promises.
 */
function isIssueWire(value: unknown): value is RepositoryIssueWire {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		ISSUE_STRING_FIELDS.every(
			(field) => typeof candidate[field] === 'string',
		) &&
		ISSUE_ARRAY_FIELDS.every((field) => Array.isArray(candidate[field])) &&
		typeof candidate.number === 'number'
	);
}

/**
 * Narrows a parsed cache row to the shape the caller expects, so a row written
 * by an older build cannot reach the renderer as a half-typed list.
 * @param value - The parsed `metadata_json` payload.
 * @returns The cached issues, or null when the row is unusable.
 */
function toCachedIssues(value: unknown): CachedRepositoryIssues | null {
	if (typeof value !== 'object' || value === null) {
		return null;
	}
	const candidate = value as Partial<CachedRepositoryIssues>;
	if (
		!Array.isArray(candidate.issues) ||
		typeof candidate.syncedAt !== 'string' ||
		!candidate.issues.every(isIssueWire)
	) {
		return null;
	}
	return { issues: candidate.issues, syncedAt: candidate.syncedAt };
}

/**
 * Reads a repository's cached issue list from `integration_metadata`, the same
 * generic table `pr-cache.ts` writes its PR snapshots to.
 * @param input - The database connection, repository, and list variant to read.
 * @returns The cached issues, or null when nothing usable is stored.
 */
export function readCachedRepositoryIssues({
	database,
	repositoryId,
	unassignedOnly = false,
}: {
	database: DatabaseSync;
	repositoryId: string;
	unassignedOnly?: boolean;
}): CachedRepositoryIssues | null {
	const row = database
		.prepare(
			`SELECT metadata_json FROM integration_metadata
			 WHERE provider = ? AND resource_type = ? AND resource_id = ?`,
		)
		.get(PROVIDER, resourceTypeFor(unassignedOnly), repositoryId) as
		| { metadata_json: string }
		| undefined;
	if (!row) {
		return null;
	}
	try {
		return toCachedIssues(JSON.parse(row.metadata_json) as unknown);
	} catch {
		return null;
	}
}

/** Upserts a repository's issue-list cache row (idempotent refresh). */
export function writeCachedRepositoryIssues({
	database,
	issues,
	repositoryId,
	syncedAt,
	unassignedOnly = false,
}: {
	database: DatabaseSync;
	issues: RepositoryIssueWire[];
	repositoryId: string;
	syncedAt: string;
	unassignedOnly?: boolean;
}): void {
	database
		.prepare(
			`INSERT INTO integration_metadata (id, provider, resource_type, resource_id, external_id, synced_at, metadata_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(provider, resource_type, resource_id, external_id)
			 DO UPDATE SET synced_at = excluded.synced_at,
				metadata_json = excluded.metadata_json,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
		)
		.run(
			randomUUID(),
			PROVIDER,
			resourceTypeFor(unassignedOnly),
			repositoryId,
			'',
			syncedAt,
			JSON.stringify({ issues, syncedAt } satisfies CachedRepositoryIssues),
		);
}

/**
 * Drops both issue-list rows for a repository. `integration_metadata` has no
 * foreign key to `repositories`, so a deleted repository leaves its cached
 * issue bodies behind unless this is called from the delete path.
 * @param input - The database connection and the repository being removed.
 */
export function deleteCachedRepositoryIssues({
	database,
	repositoryId,
}: {
	database: DatabaseSync;
	repositoryId: string;
}): void {
	database
		.prepare(
			`DELETE FROM integration_metadata
			 WHERE provider = ? AND resource_type IN (?, ?) AND resource_id = ?`,
		)
		.run(PROVIDER, RESOURCE_TYPE, UNASSIGNED_RESOURCE_TYPE, repositoryId);
}
