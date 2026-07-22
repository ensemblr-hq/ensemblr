/// <reference types="node" />

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { attachSessionToChatTab } from '../../src/main/pi-agent/session/chat-tab-plumbing.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import {
	getChatTabById,
	openChatTab,
	setChatTabMetadata,
} from '../../src/main/storage/repositories/chat-tab-repository.ts';
import { createPiSession } from '../../src/main/storage/repositories/pi-session-repository.ts';

interface Fixture {
	database: DatabaseSync;
	workspaceId: string;
}

/** Opens an isolated SQLite database seeded with a repository + workspace row. */
function openFixture(t: import('node:test').TestContext): Fixture {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-plumbing-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'plumbing-test.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-pl', 'pl', 'PL', '/tmp/ensemblr/pl', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-pl', 'repo-pl', 'pl', 'PL', '/tmp/ensemblr/pl/ws');
`);

	return { database: connection.database, workspaceId: 'ws-pl' };
}

/** Creates a persisted Pi session in the fixture workspace and returns its id. */
function newSession(fixture: Fixture): string {
	const { session } = createPiSession({
		database: fixture.database,
		input: { cwd: '/tmp/ensemblr/pl/ws', workspaceId: fixture.workspaceId },
	});
	return session.id;
}

test('reusing an auto-named tab clears the naming gate so it re-titles', (t) => {
	const fixture = openFixture(t);
	const firstSession = newSession(fixture);
	const tab = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			piSessionId: firstSession,
			title: 'Old title',
			workspaceId: fixture.workspaceId,
		},
	});
	setChatTabMetadata({
		database: fixture.database,
		id: tab.id,
		metadata: { titleAutoNamed: true, titleProvenance: 'auto' },
	});

	attachSessionToChatTab({
		chatTabId: tab.id,
		database: fixture.database,
		sessionId: newSession(fixture),
		workspaceId: fixture.workspaceId,
	});

	const reused = getChatTabById({ database: fixture.database, id: tab.id });
	assert.equal(reused?.metadata.titleAutoNamed, false);
});

test('reusing a user-named tab preserves its title provenance', (t) => {
	const fixture = openFixture(t);
	const firstSession = newSession(fixture);
	const tab = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			piSessionId: firstSession,
			title: 'User title',
			workspaceId: fixture.workspaceId,
		},
	});
	setChatTabMetadata({
		database: fixture.database,
		id: tab.id,
		metadata: { titleAutoNamed: true, titleProvenance: 'user' },
	});

	attachSessionToChatTab({
		chatTabId: tab.id,
		database: fixture.database,
		sessionId: newSession(fixture),
		workspaceId: fixture.workspaceId,
	});

	const reused = getChatTabById({ database: fixture.database, id: tab.id });
	assert.equal(reused?.metadata.titleAutoNamed, true);
	assert.equal(reused?.metadata.titleProvenance, 'user');
});
