import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { GithubPullRequestSnapshotWire } from '../../shared/ipc';

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

/** Upserts the PR snapshot cache row for a workspace (idempotent refresh). */
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
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
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
