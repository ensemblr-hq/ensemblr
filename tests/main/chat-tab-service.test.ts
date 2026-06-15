import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	type ChatTabService,
	createChatTabService,
} from '../../src/main/chat-tabs/chat-tab-service.ts';
import {
	type EnsembleDatabaseConnection,
	type EnsembleDatabaseService,
	openEnsembleDatabase,
} from '../../src/main/storage/database.ts';
import {
	getChatTabById,
	listOpenForWorkspace,
} from '../../src/main/storage/repositories/chat-tab-repository.ts';
import { createPiSession } from '../../src/main/storage/repositories/pi-session-repository.ts';

interface Fixture {
	connection: EnsembleDatabaseConnection;
	piSessionId: string;
	service: ChatTabService;
	workspaceId: string;
}

const WORKSPACE_CWD = '/tmp/ensemble/tab-service/ws';

function openFixture(t: import('node:test').TestContext): Fixture {
	const directory = mkdtempSync(
		path.join(tmpdir(), 'ensemble-chat-tab-service-'),
	);
	const connection = openEnsembleDatabase({
		databasePath: path.join(directory, 'chat-tab-service-test.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-tab-svc', 'tab-svc', 'TabSvc', '/tmp/ensemble/tab-service', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-tab-svc', 'repo-tab-svc', 'tab-svc', 'TabSvc', '${WORKSPACE_CWD}');
`);

	const { session } = createPiSession({
		database: connection.database,
		input: { cwd: WORKSPACE_CWD, workspaceId: 'ws-tab-svc' },
	});

	const databaseService: EnsembleDatabaseService = {
		close: () => undefined,
		getConnection: () => connection,
		getHealth: () => ({
			path: connection.path,
			schemaVersion: connection.schemaVersion,
			status: 'ok',
		}),
		open: () => ({
			path: connection.path,
			schemaVersion: connection.schemaVersion,
			status: 'ok',
		}),
	};

	const service = createChatTabService({
		databaseService,
		lookups: {
			piSessionExists: ({ piSessionId }) => piSessionId === session.id,
			workspaceCwd: ({ workspaceId }) =>
				workspaceId === 'ws-tab-svc' ? WORKSPACE_CWD : null,
		},
	});

	return {
		connection,
		piSessionId: session.id,
		service,
		workspaceId: 'ws-tab-svc',
	};
}

test('openTab defaults blank titles and lists the tab as open', (t) => {
	const fixture = openFixture(t);

	const tab = fixture.service.openTab({
		title: '   ',
		workspaceId: fixture.workspaceId,
	});

	assert.equal(tab.title, 'New chat');
	const { closed, open } = fixture.service.listTabs({
		workspaceId: fixture.workspaceId,
	});
	assert.deepEqual(
		open.map((row) => row.id),
		[tab.id],
	);
	assert.equal(closed.length, 0);
});

test('closeTab is a no-op for unknown and already-closed tabs', (t) => {
	const fixture = openFixture(t);

	assert.deepEqual(fixture.service.closeTab({ chatTabId: 'missing-tab' }), {
		deleted: false,
	});

	fixture.service.openTab({ workspaceId: fixture.workspaceId });
	const second = fixture.service.openTab({
		piSessionId: fixture.piSessionId,
		workspaceId: fixture.workspaceId,
	});
	fixture.service.closeTab({ chatTabId: second.id });
	// A duplicate close of an already-closed tab reports no deletion.
	assert.deepEqual(fixture.service.closeTab({ chatTabId: second.id }), {
		deleted: false,
	});
});

test('closeTab keeps the last open tab in a workspace', (t) => {
	const fixture = openFixture(t);

	const only = fixture.service.openTab({
		piSessionId: fixture.piSessionId,
		workspaceId: fixture.workspaceId,
	});
	// Min-one rule keeps the tab open, so nothing is deleted.
	assert.deepEqual(fixture.service.closeTab({ chatTabId: only.id }), {
		deleted: false,
	});

	const open = listOpenForWorkspace({
		database: fixture.connection.database,
		workspaceId: fixture.workspaceId,
	});
	assert.deepEqual(
		open.map((row) => row.id),
		[only.id],
	);
});

test('closeTab deletes empty tabs instead of entering history', (t) => {
	const fixture = openFixture(t);

	fixture.service.openTab({
		piSessionId: fixture.piSessionId,
		workspaceId: fixture.workspaceId,
	});
	const empty = fixture.service.openTab({
		workspaceId: fixture.workspaceId,
	});
	// Empty tabs are hard-deleted, so the close reports a deletion.
	assert.deepEqual(fixture.service.closeTab({ chatTabId: empty.id }), {
		deleted: true,
	});

	assert.equal(
		getChatTabById({
			database: fixture.connection.database,
			id: empty.id,
		}),
		null,
	);
	assert.equal(
		fixture.service.listTabs({ workspaceId: fixture.workspaceId }).closed
			.length,
		0,
	);
});

test('closeTab moves session-bound tabs into closed history', (t) => {
	const fixture = openFixture(t);

	fixture.service.openTab({ workspaceId: fixture.workspaceId });
	const bound = fixture.service.openTab({
		piSessionId: fixture.piSessionId,
		workspaceId: fixture.workspaceId,
	});
	// Session-bound tabs are archived (restorable), not deleted.
	assert.deepEqual(fixture.service.closeTab({ chatTabId: bound.id }), {
		deleted: false,
	});

	const { closed } = fixture.service.listTabs({
		workspaceId: fixture.workspaceId,
	});
	assert.deepEqual(
		closed.map((row) => row.id),
		[bound.id],
	);

	const restored = fixture.service.restoreTab({ chatTabId: bound.id });
	assert.equal(restored?.id, bound.id);
	assert.equal(restored?.closedAt, null);
});

test('bindPiSession validates tab and session existence', (t) => {
	const fixture = openFixture(t);

	const tab = fixture.service.openTab({ workspaceId: fixture.workspaceId });

	assert.throws(
		() =>
			fixture.service.bindPiSession({
				chatTabId: 'missing-tab',
				piSessionId: fixture.piSessionId,
			}),
		/does not exist/,
	);
	assert.throws(
		() =>
			fixture.service.bindPiSession({
				chatTabId: tab.id,
				piSessionId: 'missing-session',
			}),
		/does not exist/,
	);

	fixture.service.bindPiSession({
		chatTabId: tab.id,
		piSessionId: fixture.piSessionId,
	});
	assert.equal(
		getChatTabById({ database: fixture.connection.database, id: tab.id })
			?.piSessionId,
		fixture.piSessionId,
	);
});

test('listClosedWithSummary resolves summary paths under .context/sessions', (t) => {
	const fixture = openFixture(t);

	fixture.service.openTab({ workspaceId: fixture.workspaceId });
	const bound = fixture.service.openTab({
		piSessionId: fixture.piSessionId,
		workspaceId: fixture.workspaceId,
	});
	fixture.service.closeTab({ chatTabId: bound.id });

	const entries = fixture.service.listClosedWithSummary({
		workspaceId: fixture.workspaceId,
	});
	assert.equal(entries.length, 1);
	assert.equal(entries[0]?.tab.id, bound.id);
	assert.ok(entries[0]?.closedAt);
	assert.equal(
		entries[0]?.summaryPath,
		path.join(WORKSPACE_CWD, '.context', 'sessions', `${bound.id}.md`),
	);
});

test('openTab blocks the sixth chat tab with the limit marker', (t) => {
	const fixture = openFixture(t);

	for (let index = 0; index < 5; index += 1) {
		fixture.service.openTab({
			title: `Chat ${index + 1}`,
			workspaceId: fixture.workspaceId,
		});
	}

	assert.throws(
		() => fixture.service.openTab({ workspaceId: fixture.workspaceId }),
		/CHAT_TAB_LIMIT_REACHED/,
	);

	const { open } = fixture.service.listTabs({
		workspaceId: fixture.workspaceId,
	});
	assert.equal(open.length, 5);
});

test('non-chat tabs do not count against the chat-tab limit', (t) => {
	const fixture = openFixture(t);

	for (let index = 0; index < 5; index += 1) {
		fixture.service.openTab({
			title: `Chat ${index + 1}`,
			workspaceId: fixture.workspaceId,
		});
	}

	const fileTab = fixture.service.openTab({
		kind: 'file',
		metadata: { filePath: 'src/index.ts' },
		title: 'index.ts',
		workspaceId: fixture.workspaceId,
	});
	assert.equal(fileTab.kind, 'file');

	const { open } = fixture.service.listTabs({
		workspaceId: fixture.workspaceId,
	});
	assert.equal(open.length, 6);
});

test('closing a chat tab at the limit allows a replacement to open', (t) => {
	const fixture = openFixture(t);

	const tabs = Array.from({ length: 5 }, (_, index) =>
		fixture.service.openTab({
			piSessionId: index === 0 ? fixture.piSessionId : undefined,
			title: `Chat ${index + 1}`,
			workspaceId: fixture.workspaceId,
		}),
	);

	fixture.service.closeTab({ chatTabId: tabs[4]?.id ?? '' });
	assert.doesNotThrow(() =>
		fixture.service.openTab({ workspaceId: fixture.workspaceId }),
	);
});

test('opening the same file path twice re-focuses the existing tab', (t) => {
	const fixture = openFixture(t);

	fixture.service.openTab({ workspaceId: fixture.workspaceId });
	const first = fixture.service.openTab({
		kind: 'file',
		metadata: { filePath: 'src/app.ts' },
		title: 'app.ts',
		workspaceId: fixture.workspaceId,
	});
	const second = fixture.service.openTab({
		kind: 'file',
		metadata: { filePath: 'src/app.ts' },
		title: 'app.ts',
		workspaceId: fixture.workspaceId,
	});

	assert.equal(second.id, first.id);
	const { open } = fixture.service.listTabs({
		workspaceId: fixture.workspaceId,
	});
	assert.equal(open.filter((tab) => tab.kind === 'file').length, 1);
});

test('closeTab hard-deletes non-chat tabs without entering history', (t) => {
	const fixture = openFixture(t);

	fixture.service.openTab({ workspaceId: fixture.workspaceId });
	const fileTab = fixture.service.openTab({
		kind: 'file',
		metadata: { filePath: 'README.md' },
		title: 'README.md',
		workspaceId: fixture.workspaceId,
	});
	// Non-chat tabs are hard-deleted on close.
	assert.deepEqual(fixture.service.closeTab({ chatTabId: fileTab.id }), {
		deleted: true,
	});

	assert.equal(
		getChatTabById({
			database: fixture.connection.database,
			id: fileTab.id,
		}),
		null,
	);
	assert.equal(
		fixture.service.listTabs({ workspaceId: fixture.workspaceId }).closed
			.length,
		0,
	);
});

test('min-one rule counts chat tabs only, not open file tabs', (t) => {
	const fixture = openFixture(t);

	const chat = fixture.service.openTab({
		piSessionId: fixture.piSessionId,
		workspaceId: fixture.workspaceId,
	});
	fixture.service.openTab({
		kind: 'file',
		metadata: { filePath: 'src/main.ts' },
		title: 'main.ts',
		workspaceId: fixture.workspaceId,
	});

	fixture.service.closeTab({ chatTabId: chat.id });

	const open = listOpenForWorkspace({
		database: fixture.connection.database,
		workspaceId: fixture.workspaceId,
	});
	assert.ok(open.some((tab) => tab.id === chat.id));
});

test('service surfaces a clear error when the database is closed', (t) => {
	const fixture = openFixture(t);

	const service = createChatTabService({
		databaseService: {
			close: () => undefined,
			getConnection: () => null,
			getHealth: () => ({ path: '', schemaVersion: 0, status: 'error' }),
			open: () => ({ path: '', schemaVersion: 0, status: 'error' }),
		},
		lookups: {
			piSessionExists: () => true,
			workspaceCwd: () => null,
		},
	});

	assert.throws(
		() => service.listTabs({ workspaceId: fixture.workspaceId }),
		/Database is not open/,
	);
});
