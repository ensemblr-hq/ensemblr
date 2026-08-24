import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import { listProjectRows } from '../../src/main/storage/repositories/repository-row-repository.ts';

let database: DatabaseSync;
let directory: string;

beforeEach(() => {
	directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-project-listing-'));
	database = openEnsemblrDatabase({
		databasePath: path.join(directory, 'projects.db'),
	}).database;
});

afterEach(() => {
	database.close();
	rmSync(directory, { force: true, recursive: true });
});

// The listing is what the Concierge reads to find a project to cut a workspace
// off, so an idle project has to appear with a count of zero rather than be
// filtered out by the join that counts its workspaces.
describe('the project listing behind ensemblr_list_projects', () => {
	it('counts live workspaces per project and keeps the idle ones', () => {
		database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES
	('repo-busy', 'busy', 'Busy', '/repos/busy', 'main'),
	('repo-idle', 'idle', 'Idle', '/repos/idle', NULL);
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES
	('ws-one', 'repo-busy', 'one', 'One', '/repos/busy/ws-one'),
	('ws-two', 'repo-busy', 'two', 'Two', '/repos/busy/ws-two');
`);

		expect(listProjectRows({ database })).toEqual([
			{
				defaultBranch: 'main',
				id: 'repo-busy',
				name: 'Busy',
				path: '/repos/busy',
				slug: 'busy',
				workspaceCount: 2,
			},
			{
				defaultBranch: null,
				id: 'repo-idle',
				name: 'Idle',
				path: '/repos/idle',
				slug: 'idle',
				workspaceCount: 0,
			},
		]);
	});

	it('leaves archived workspaces out of the count', () => {
		database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-one', 'one', 'One', '/repos/one', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path, archived_at)
VALUES
	('ws-live', 'repo-one', 'live', 'Live', '/repos/one/live', NULL),
	('ws-gone', 'repo-one', 'gone', 'Gone', '/repos/one/gone', '2026-08-01T00:00:00.000Z');
`);

		expect(listProjectRows({ database })[0]?.workspaceCount).toBe(1);
	});

	// An archived project is one the user removed from the app. Listing it hands
	// the Concierge a `projectId` it would then cut a workspace off, so the outer
	// filter matters as much as the one on the join.
	it('leaves archived repositories out of the listing entirely', () => {
		database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch, archived_at)
VALUES
	('repo-live', 'live', 'Live', '/repos/live', 'main', NULL),
	('repo-gone', 'gone', 'Gone', '/repos/gone', 'main', '2026-08-01T00:00:00.000Z');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-gone', 'repo-gone', 'one', 'One', '/repos/gone/ws-one');
`);

		expect(listProjectRows({ database }).map((row) => row.id)).toEqual([
			'repo-live',
		]);
	});

	// Both listings are read against the same sidebar, so they sort alike: name
	// first, case-insensitively, with slug and id only as tie-breakers.
	it('orders projects by name the way the sidebar does', () => {
		database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES
	('repo-c', 'charlie', 'charlie', '/repos/charlie', NULL),
	('repo-a', 'alpha', 'Alpha', '/repos/alpha', NULL),
	('repo-b', 'bravo', 'BRAVO', '/repos/bravo', NULL);
`);

		expect(listProjectRows({ database }).map((row) => row.name)).toEqual([
			'Alpha',
			'BRAVO',
			'charlie',
		]);
	});

	it('answers empty when nothing has been opened', () => {
		expect(listProjectRows({ database })).toEqual([]);
	});
});
