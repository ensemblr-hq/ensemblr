import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import {
	bindPiSession,
	closeChatTab,
	deleteChatTab,
	getRuntimeState,
	listClosedForWorkspace,
	listOpenChatTabs,
	listOpenForWorkspace,
	markClosed,
	openChatTab,
	renameChatTab,
	reorderChatTabs,
	restoreChatTab,
	setRuntimeState,
} from '../../src/main/storage/repositories/chat-tab-repository.ts';
import { createPiSession } from '../../src/main/storage/repositories/pi-session-repository.ts';

interface Fixture {
	database: DatabaseSync;
	piSessionId: string;
	workspaceId: string;
}

function openFixture(t: import('node:test').TestContext): Fixture {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-chat-tab-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'chat-tab-test.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-tab', 'tab', 'Tab', '/tmp/ensemblr/tab', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-tab', 'repo-tab', 'tab', 'Tab', '/tmp/ensemblr/tab/ws');
`);

	const { session } = createPiSession({
		database: connection.database,
		input: { cwd: '/tmp/ensemblr/tab/ws', workspaceId: 'ws-tab' },
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

test('listOpenForWorkspace mirrors listOpenChatTabs', (t) => {
	const fixture = openFixture(t);

	openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			piSessionId: fixture.piSessionId,
			title: 'Alpha',
			workspaceId: fixture.workspaceId,
		},
	});
	openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			piSessionId: fixture.piSessionId,
			title: 'Beta',
			workspaceId: fixture.workspaceId,
		},
	});

	const direct = listOpenChatTabs({
		database: fixture.database,
		workspaceId: fixture.workspaceId,
	});
	const aliased = listOpenForWorkspace({
		database: fixture.database,
		workspaceId: fixture.workspaceId,
	});
	assert.deepEqual(
		aliased.map((tab) => tab.id),
		direct.map((tab) => tab.id),
	);
	assert.equal(aliased.length, 2);
});

test('restoreChatTab reopens a closed tab at the end of open tabs', (t) => {
	const fixture = openFixture(t);

	const first = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			title: 'First',
			workspaceId: fixture.workspaceId,
		},
	});
	const second = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			title: 'Second',
			workspaceId: fixture.workspaceId,
		},
	});
	closeChatTab({ database: fixture.database, id: first.id });

	const restored = restoreChatTab({ database: fixture.database, id: first.id });

	assert.equal(restored?.closedAt, null);
	assert.deepEqual(
		listOpenChatTabs({
			database: fixture.database,
			workspaceId: fixture.workspaceId,
		}).map((tab) => tab.id),
		[second.id, first.id],
	);
});

test('listClosedForWorkspace returns closed tabs in reverse-closed order', (t) => {
	const fixture = openFixture(t);

	const firstClosed = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			title: 'First',
			workspaceId: fixture.workspaceId,
		},
	});
	const secondClosed = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			title: 'Second',
			workspaceId: fixture.workspaceId,
		},
	});

	closeChatTab({ database: fixture.database, id: firstClosed.id });
	// Force a different closed_at by sleeping deterministically.
	const second = markClosed({
		database: fixture.database,
		id: secondClosed.id,
	});
	assert.ok(second?.closedAt);

	const closed = listClosedForWorkspace({
		database: fixture.database,
		workspaceId: fixture.workspaceId,
	});
	assert.equal(closed.length, 2);
	assert.equal(closed[0]?.id, secondClosed.id);
	assert.equal(closed[1]?.id, firstClosed.id);
});

test('markClosed is an alias for closeChatTab', (t) => {
	const fixture = openFixture(t);

	const tab = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			piSessionId: fixture.piSessionId,
			title: 'Closing soon',
			workspaceId: fixture.workspaceId,
		},
	});
	const closed = markClosed({ database: fixture.database, id: tab.id });
	assert.ok(closed?.closedAt);
});

test('deleteChatTab removes a tab without preserving closed history', (t) => {
	const fixture = openFixture(t);

	const tab = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			title: 'Empty draft',
			workspaceId: fixture.workspaceId,
		},
	});
	deleteChatTab({ database: fixture.database, id: tab.id });

	assert.equal(
		listOpenChatTabs({
			database: fixture.database,
			workspaceId: fixture.workspaceId,
		}).some((candidate) => candidate.id === tab.id),
		false,
	);
	assert.equal(
		listClosedForWorkspace({
			database: fixture.database,
			workspaceId: fixture.workspaceId,
		}).some((candidate) => candidate.id === tab.id),
		false,
	);
});

test('bindPiSession attaches a pi session to a tab', (t) => {
	const fixture = openFixture(t);

	const tab = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			title: 'Unbound',
			workspaceId: fixture.workspaceId,
		},
	});
	assert.equal(tab.piSessionId, null);

	const bound = bindPiSession({
		database: fixture.database,
		id: tab.id,
		piSessionId: fixture.piSessionId,
	});
	assert.equal(bound?.piSessionId, fixture.piSessionId);
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
