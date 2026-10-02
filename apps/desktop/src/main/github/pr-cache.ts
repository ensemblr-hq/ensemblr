import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { GithubPullRequestSnapshotWire } from '../../shared/ipc/contracts/github';

const PROVIDER = 'github';
const RESOURCE_TYPE = 'pull-request';

/**
 * Reads the cached PR snapshot for a workspace from `integration_metadata`.
 * GitHub stays the source of truth — the cache only smooths polling gaps and
 * offline launches (ENS-055).
 */
export function readCachedPullRequestSnapshot({
	database,
	workspaceId,
}: {
	database: DatabaseSync;
	workspaceId: string;
}): GithubPullRequestSnapshotWire | null {
	const row = database
		.prepare(
			`SELECT metadata_json FROM integration_metadata
			 WHERE provider = ? AND resource_type = ? AND resource_id = ?`,
		)
		.get(PROVIDER, RESOURCE_TYPE, workspaceId) as
		| { metadata_json: string }
		| undefined;
	if (!row) {
		return null;
	}
	try {
		const parsed = JSON.parse(row.metadata_json) as unknown;
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			'syncedAt' in parsed &&
			'pullRequest' in parsed
		) {
			return parsed as GithubPullRequestSnapshotWire;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Drops a workspace's cached PR snapshot so the next read falls through to
 * `gh` instead of serving a pull request the workspace has moved off (e.g. when
 * it continues onto a successor branch after a merge).
 */
export function deleteCachedPullRequestSnapshot({
	database,
	workspaceId,
}: {
	database: DatabaseSync;
	workspaceId: string;
}): void {
	database
		.prepare(
			`DELETE FROM integration_metadata
			 WHERE provider = ? AND resource_type = ? AND resource_id = ?`,
		)
		.run(PROVIDER, RESOURCE_TYPE, workspaceId);
}

/**
 * Upserts the PR snapshot cache row for a workspace (idempotent refresh),
 * refusing a snapshot older than the one already stored.
 *
 * Two writers race for this row: the active workspace's own poll and the
 * background sweeper, each of which spends a second or more inside `gh` before
 * it writes. Without the guard a slow earlier fetch lands after a fast later one
 * and pushes the persisted status backwards — which every sidebar row, the
 * header pill, and a cold launch then read as the truth. `synced_at` is written
 * as `toISOString()`, so it sorts chronologically as text; an equal stamp is
 * allowed through, since a same-instant rewrite carries no older claim.
 */
export function writeCachedPullRequestSnapshot({
	database,
	snapshot,
	workspaceId,
}: {
	database: DatabaseSync;
	snapshot: GithubPullRequestSnapshotWire;
	workspaceId: string;
}): void {
	database
		.prepare(
			`INSERT INTO integration_metadata (id, provider, resource_type, resource_id, external_id, synced_at, metadata_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(provider, resource_type, resource_id, external_id)
			 DO UPDATE SET synced_at = excluded.synced_at,
				metadata_json = excluded.metadata_json,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			 WHERE integration_metadata.synced_at IS NULL
				OR excluded.synced_at >= integration_metadata.synced_at`,
		)
		.run(
			randomUUID(),
			PROVIDER,
			RESOURCE_TYPE,
			workspaceId,
			'',
			snapshot.syncedAt,
			JSON.stringify(snapshot),
		);
}
