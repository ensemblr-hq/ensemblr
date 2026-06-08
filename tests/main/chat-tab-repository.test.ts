import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { openEnsembleDatabase } from '../../src/main/storage/database.ts';
import {
	closeChatTab,
	getRuntimeState,
	listOpenChatTabs,
	openChatTab,
	renameChatTab,
	reorderChatTabs,
	setRuntimeState,
} from '../../src/main/storage/repositories/chat-tab-repository.ts';
import { createPiSession } from '../../src/main/storage/repositories/pi-session-repository.ts';

interface Fixture {
	database: DatabaseSync;
	piSessionId: string;
	workspaceId: string;
}

function openFixture(t: import('node:test').TestContext): Fixture {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-chat-tab-'));
	const connection = openEnsembleDatabase({
		databasePath: path.join(directory, 'chat-tab-test.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-tab', 'tab', 'Tab', '/tmp/ensemble/tab', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-tab', 'repo-tab', 'tab', 'Tab', '/tmp/ensemble/tab/ws');
`);

	const { session } = createPiSession({
		database: connection.database,
		input: { cwd: '/tmp/ensemble/tab/ws', workspaceId: 'ws-tab' },
	});

	return {
		database: connection.database,
		piSessionId: session.id,
		workspaceId: 'ws-tab',
	};
}

test('openChatTab assigns sequential positions to open tabs', (t) => {
	const fixture = openFixture(t);

	const a = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			piSessionId: fixture.piSessionId,
			title: 'Chat A',
			workspaceId: fixture.workspaceId,
		},
	});
	const b = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			piSessionId: fixture.piSessionId,
			title: 'Chat B',
			workspaceId: fixture.workspaceId,
		},
	});

	assert.equal(a.position, 0);
	assert.equal(b.position, 1);
	assert.equal(b.kind, 'chat');
	assert.equal(b.closedAt, null);
});

test('closeChatTab leaves the row but flags closed_at', (t) => {
	const fixture = openFixture(t);

	const tab = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			piSessionId: fixture.piSessionId,
			title: 'Chat',
			workspaceId: fixture.workspaceId,
		},
	});
	const closed = closeChatTab({ database: fixture.database, id: tab.id });

	assert.ok(closed?.closedAt);
	assert.equal(
		listOpenChatTabs({
			database: fixture.database,
			workspaceId: fixture.workspaceId,
		}).length,
		0,
	);
});

test('preview tabs can omit pi_session_id', (t) => {
	const fixture = openFixture(t);

	const tab = openChatTab({
		database: fixture.database,
		input: {
			kind: 'preview',
			title: 'Preview',
			workspaceId: fixture.workspaceId,
		},
	});

	assert.equal(tab.kind, 'preview');
	assert.equal(tab.piSessionId, null);
});

test('reorderChatTabs reflects supplied id sequence', (t) => {
	const fixture = openFixture(t);

	const tabs = ['One', 'Two', 'Three'].map((title) =>
		openChatTab({
			database: fixture.database,
			input: { kind: 'chat', title, workspaceId: fixture.workspaceId },
		}),
	);
	const [first, second, third] = tabs;
	if (!first || !second || !third) {
		throw new Error('expected three open tabs');
	}
	const reorderedIds = [third.id, first.id, second.id];

	const reordered = reorderChatTabs({
		database: fixture.database,
		orderedIds: reorderedIds,
		workspaceId: fixture.workspaceId,
	});

	assert.deepEqual(
		reordered.map((tab) => tab.id),
		reorderedIds,
	);
});

test('renameChatTab updates title only', (t) => {
	const fixture = openFixture(t);

	const tab = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			piSessionId: fixture.piSessionId,
			title: 'Original',
			workspaceId: fixture.workspaceId,
		},
	});
	const renamed = renameChatTab({
		database: fixture.database,
		id: tab.id,
		title: 'Renamed',
	});

	assert.equal(renamed?.title, 'Renamed');
	assert.equal(renamed?.position, tab.position);
});

test('runtime state upserts and is keyed by workspace', (t) => {
	const fixture = openFixture(t);

	const initial = getRuntimeState({
		database: fixture.database,
		workspaceId: fixture.workspaceId,
	});
	assert.equal(initial.activeTabId, null);
	assert.equal(initial.lastActiveSessionId, null);

	const tab = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			piSessionId: fixture.piSessionId,
			title: 'Chat',
			workspaceId: fixture.workspaceId,
		},
	});

	const set = setRuntimeState({
		activeTabId: tab.id,
		database: fixture.database,
		lastActiveSessionId: fixture.piSessionId,
		workspaceId: fixture.workspaceId,
	});
	assert.equal(set.activeTabId, tab.id);
	assert.equal(set.lastActiveSessionId, fixture.piSessionId);

	const cleared = setRuntimeState({
		activeTabId: null,
		database: fixture.database,
		lastActiveSessionId: null,
		workspaceId: fixture.workspaceId,
	});
	assert.equal(cleared.activeTabId, null);
});
