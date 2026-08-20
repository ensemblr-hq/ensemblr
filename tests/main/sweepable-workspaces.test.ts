import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, test } from 'vitest';

import { listSweepableWorkspaces } from '../../src/main/github/sweepable-workspaces.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()?.();
	}
});

/** Opens a throwaway database holding one repository to hang workspaces off. */
function openTestDatabase(): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-sweepable-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'sweepable-test.db'),
	});
	cleanups.push(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});
	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-sweep', 'sweep', 'Sweep', '/tmp/ensemblr/sweep', 'master');
`);
	return connection.database;
}

/** Inserts a workspace, optionally archived, and returns its id. */
function insertWorkspace(
	database: DatabaseSync,
	id: string,
	archived = false,
): string {
	database
		.prepare(
			`INSERT INTO workspaces (id, repository_id, slug, name, path, branch_name, base_branch, archived_at)
			 VALUES (?, 'repo-sweep', ?, ?, ?, ?, 'master', ?)`,
		)
		.run(
			id,
			id,
			id,
			`/tmp/ensemblr/sweep/${id}`,
			`feature/${id}`,
			archived ? '2026-08-20T11:00:00.000Z' : null,
		);
	return id;
}

/** Writes a raw cached PR snapshot row for a workspace. */
function cacheSnapshot(
	database: DatabaseSync,
	workspaceId: string,
	metadataJson: string,
): void {
	database
		.prepare(
			`INSERT INTO integration_metadata (id, provider, resource_type, resource_id, external_id, synced_at, metadata_json)
			 VALUES (?, 'github', 'pull-request', ?, '', '2026-08-20T11:41:00.000Z', ?)`,
		)
		.run(`im-${workspaceId}`, workspaceId, metadataJson);
}

/** Serializes a snapshot around a pull request's state and check buckets. */
function snapshotJson(
	state: string | null,
	buckets: readonly string[],
): string {
	return JSON.stringify({
		branchSync: null,
		pullRequest: state
			? { checks: buckets.map((bucket) => ({ bucket })), state }
			: null,
		syncedAt: '2026-08-20T11:41:00.000Z',
	});
}

describe('listSweepableWorkspaces', () => {
	test('flags an open pull request with a check still running', () => {
		const database = openTestDatabase();
		insertWorkspace(database, 'ws-pending');
		cacheSnapshot(
			database,
			'ws-pending',
			snapshotJson('open', ['passing', 'pending']),
		);

		expect(listSweepableWorkspaces({ database })).toEqual([
			{
				hasPendingChecks: true,
				id: 'ws-pending',
				path: '/tmp/ensemblr/sweep/ws-pending',
			},
		]);
	});

	test('does not flag an open pull request whose checks have all landed', () => {
		const database = openTestDatabase();
		insertWorkspace(database, 'ws-settled');
		cacheSnapshot(
			database,
			'ws-settled',
			snapshotJson('open', ['passing', 'failing', 'skipped']),
		);

		expect(listSweepableWorkspaces({ database })[0]?.hasPendingChecks).toBe(
			false,
		);
	});

	test('does not flag a merged pull request that still lists a pending check', () => {
		const database = openTestDatabase();
		insertWorkspace(database, 'ws-merged');
		cacheSnapshot(database, 'ws-merged', snapshotJson('merged', ['pending']));

		expect(listSweepableWorkspaces({ database })[0]?.hasPendingChecks).toBe(
			false,
		);
	});

	test('does not flag a workspace with no cached snapshot at all', () => {
		const database = openTestDatabase();
		insertWorkspace(database, 'ws-cold');

		expect(listSweepableWorkspaces({ database })[0]?.hasPendingChecks).toBe(
			false,
		);
	});

	test('does not flag a cache row holding no pull request', () => {
		const database = openTestDatabase();
		insertWorkspace(database, 'ws-nopr');
		cacheSnapshot(database, 'ws-nopr', snapshotJson(null, []));

		expect(listSweepableWorkspaces({ database })[0]?.hasPendingChecks).toBe(
			false,
		);
	});

	test('survives a cache row that is not parseable JSON', () => {
		const database = openTestDatabase();
		insertWorkspace(database, 'ws-corrupt');
		cacheSnapshot(database, 'ws-corrupt', 'not json at all');

		expect(listSweepableWorkspaces({ database })).toEqual([
			{
				hasPendingChecks: false,
				id: 'ws-corrupt',
				path: '/tmp/ensemblr/sweep/ws-corrupt',
			},
		]);
	});

	test('leaves archived workspaces out of the listing', () => {
		const database = openTestDatabase();
		insertWorkspace(database, 'ws-live');
		insertWorkspace(database, 'ws-archived', true);
		cacheSnapshot(database, 'ws-archived', snapshotJson('open', ['pending']));

		expect(listSweepableWorkspaces({ database }).map((row) => row.id)).toEqual([
			'ws-live',
		]);
	});
});
