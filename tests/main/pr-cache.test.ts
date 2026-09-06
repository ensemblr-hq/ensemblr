import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, test } from 'vitest';

import {
	readCachedPullRequestSnapshot,
	writeCachedPullRequestSnapshot,
} from '../../src/main/github/pr-cache.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import { getRepositoryWorkspaceNavigationSnapshot } from '../../src/main/storage/repositories/repository-workspace-navigation-repository.ts';
import type { GithubPullRequestSnapshotWire } from '../../src/shared/ipc/contracts/github';

const WORKSPACE_ID = 'ws-pr-cache';
const EARLIER = '2026-08-20T11:00:00.000Z';
const LATER = '2026-08-20T11:30:00.000Z';

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()?.();
	}
});

/** Opens a throwaway database holding one repository and one workspace. */
function openTestDatabase(): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-pr-cache-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'pr-cache-test.db'),
	});
	cleanups.push(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});
	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-pr-cache', 'pr-cache', 'PR cache', '/tmp/ensemblr/pr-cache', 'master');
INSERT INTO workspaces (id, repository_id, slug, name, path, branch_name, base_branch)
VALUES ('${WORKSPACE_ID}', 'repo-pr-cache', 'feature', 'Feature', '/tmp/ensemblr/pr-cache/feature', 'feature', 'master');
`);
	return connection.database;
}

/** A snapshot stamped at `syncedAt` whose PR carries the given check bucket. */
function snapshotAt(
	syncedAt: string,
	bucket: 'failing' | 'passing' | 'pending',
): GithubPullRequestSnapshotWire {
	return {
		branchSync: null,
		pullRequest: {
			additions: null,
			baseRefName: 'master',
			body: '',
			checks: [{ bucket, id: `check-${bucket}`, name: 'build' }],
			comments: [],
			deletions: null,
			deployments: [],
			headRefName: 'feature',
			headRefOid: 'abc123',
			isDraft: false,
			mergeable: 'mergeable',
			number: 42,
			state: 'open',
			title: 'A PR',
			updatedAt: syncedAt,
			url: 'https://github.com/o/r/pull/42',
		},
		syncedAt,
	};
}

describe('writeCachedPullRequestSnapshot', () => {
	test('stores a snapshot for a workspace that has none', () => {
		const database = openTestDatabase();
		writeCachedPullRequestSnapshot({
			database,
			snapshot: snapshotAt(EARLIER, 'pending'),
			workspaceId: WORKSPACE_ID,
		});
		expect(
			readCachedPullRequestSnapshot({ database, workspaceId: WORKSPACE_ID })
				?.syncedAt,
		).toBe(EARLIER);
	});

	test('a later snapshot replaces an earlier one', () => {
		const database = openTestDatabase();
		writeCachedPullRequestSnapshot({
			database,
			snapshot: snapshotAt(EARLIER, 'pending'),
			workspaceId: WORKSPACE_ID,
		});
		writeCachedPullRequestSnapshot({
			database,
			snapshot: snapshotAt(LATER, 'passing'),
			workspaceId: WORKSPACE_ID,
		});
		const stored = readCachedPullRequestSnapshot({
			database,
			workspaceId: WORKSPACE_ID,
		});
		expect(stored?.syncedAt).toBe(LATER);
		expect(stored?.pullRequest?.checks[0]?.bucket).toBe('passing');
	});

	test('an earlier snapshot never overwrites a later one', () => {
		const database = openTestDatabase();
		writeCachedPullRequestSnapshot({
			database,
			snapshot: snapshotAt(LATER, 'passing'),
			workspaceId: WORKSPACE_ID,
		});
		writeCachedPullRequestSnapshot({
			database,
			snapshot: snapshotAt(EARLIER, 'pending'),
			workspaceId: WORKSPACE_ID,
		});
		const stored = readCachedPullRequestSnapshot({
			database,
			workspaceId: WORKSPACE_ID,
		});
		expect(stored?.syncedAt).toBe(LATER);
		expect(stored?.pullRequest?.checks[0]?.bucket).toBe('passing');
	});

	test('a same-instant rewrite still lands', () => {
		const database = openTestDatabase();
		writeCachedPullRequestSnapshot({
			database,
			snapshot: snapshotAt(EARLIER, 'pending'),
			workspaceId: WORKSPACE_ID,
		});
		writeCachedPullRequestSnapshot({
			database,
			snapshot: snapshotAt(EARLIER, 'failing'),
			workspaceId: WORKSPACE_ID,
		});
		expect(
			readCachedPullRequestSnapshot({ database, workspaceId: WORKSPACE_ID })
				?.pullRequest?.checks[0]?.bucket,
		).toBe('failing');
	});
});

describe('navigation snapshot PR presentation', () => {
	test('stamps the row with the cached snapshot it was derived from', () => {
		const database = openTestDatabase();
		writeCachedPullRequestSnapshot({
			database,
			snapshot: snapshotAt(LATER, 'pending'),
			workspaceId: WORKSPACE_ID,
		});
		const navigation = getRepositoryWorkspaceNavigationSnapshot({ database });
		const workspace = navigation.repositories[0]?.workspaces[0];
		expect(workspace?.pullRequest).toEqual({
			number: 42,
			status: 'checking',
			syncedAt: LATER,
		});
	});
});
