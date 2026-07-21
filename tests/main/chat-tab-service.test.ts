/// <reference types="node" />

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	type ChatTabService,
	createChatTabService,
} from '../../src/main/chat-tabs/chat-tab-service.ts';
import {
	type EnsemblrDatabaseConnection,
	type EnsemblrDatabaseService,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';
import {
	getChatTabById,
	listOpenForWorkspace,
	setChatTabMetadata,
} from '../../src/main/storage/repositories/chat-tab-repository.ts';
import { createPiSession } from '../../src/main/storage/repositories/pi-session-repository.ts';

interface Fixture {
	connection: EnsemblrDatabaseConnection;
	piSessionId: string;
	service: ChatTabService;
	workspaceId: string;
}

const WORKSPACE_CWD = '/tmp/ensemblr/tab-service/ws';

function openFixture(t: import('node:test').TestContext): Fixture {
	const directory = mkdtempSync(
		path.join(tmpdir(), 'ensemblr-chat-tab-service-'),
	);
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'chat-tab-service-test.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-tab-svc', 'tab-svc', 'TabSvc', '/tmp/ensemblr/tab-service', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-tab-svc', 'repo-tab-svc', 'tab-svc', 'TabSvc', '${WORKSPACE_CWD}');
`);

	const { session } = createPiSession({
		database: connection.database,
		input: { cwd: WORKSPACE_CWD, workspaceId: 'ws-tab-svc' },
	});

	const databaseService: EnsemblrDatabaseService = {
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

test('listClosedWithSummary lists closed tabs without a summary as restorable', (t) => {
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
	// The tab still enters history so it can be restored; it just carries no
	// attachable transcript, signalled by an empty summary path/title.
	assert.equal(entries.length, 1);
	assert.equal(entries[0]?.tab.id, bound.id);
	assert.equal(entries[0]?.summaryPath, '');
	assert.equal(entries[0]?.summaryTitle, null);
});

test('listClosedWithSummary leaves the summary empty when the file is gone', (t) => {
	const fixture = openFixture(t);

	fixture.service.openTab({ workspaceId: fixture.workspaceId });
	const bound = fixture.service.openTab({
		piSessionId: fixture.piSessionId,
		workspaceId: fixture.workspaceId,
	});
	fixture.service.closeTab({ chatTabId: bound.id });

	setChatTabMetadata({
		database: fixture.connection.database,
		id: bound.id,
		metadata: {
			summary: {
				path: path.join(WORKSPACE_CWD, '.context', 'sessions', 'missing.md'),
				title: 'Written but deleted',
			},
		},
	});

	const entries = fixture.service.listClosedWithSummary({
		workspaceId: fixture.workspaceId,
	});
	// The tab is still restorable; the stale summary marker must not surface a
	// path whose attach would fail with ENOENT.
	assert.equal(entries.length, 1);
	assert.equal(entries[0]?.tab.id, bound.id);
	assert.equal(entries[0]?.summaryPath, '');
	assert.equal(entries[0]?.summaryTitle, null);
});

test('listClosedWithSummary lists a closed tab whose summary file exists', (t) => {
	const fixture = openFixture(t);

	fixture.service.openTab({ workspaceId: fixture.workspaceId });
	const bound = fixture.service.openTab({
		piSessionId: fixture.piSessionId,
		workspaceId: fixture.workspaceId,
	});
	fixture.service.closeTab({ chatTabId: bound.id });

	const summaryPath = path.join(
		WORKSPACE_CWD,
		'.context',
		'sessions',
		`${bound.id}.md`,
	);
	mkdirSync(path.dirname(summaryPath), { recursive: true });
	writeFileSync(summaryPath, '# Three rules of robotics\n');
	t.after(() => {
		rmSync(path.join(WORKSPACE_CWD, '.context'), {
			force: true,
			recursive: true,
		});
	});
	setChatTabMetadata({
		database: fixture.connection.database,
		id: bound.id,
		metadata: {
			summary: { path: summaryPath, title: 'Three rules of robotics' },
		},
	});

	const entries = fixture.service.listClosedWithSummary({
		workspaceId: fixture.workspaceId,
	});
	assert.equal(entries.length, 1);
	assert.equal(entries[0]?.tab.id, bound.id);
	assert.ok(entries[0]?.closedAt);
	assert.equal(entries[0]?.summaryTitle, 'Three rules of robotics');
	assert.equal(entries[0]?.summaryPath, summaryPath);
});

test('listClosedWithSummary trusts the persisted summary path outside the workspace root', (t) => {
	const fixture = openFixture(t);

	fixture.service.openTab({ workspaceId: fixture.workspaceId });
	const bound = fixture.service.openTab({
		piSessionId: fixture.piSessionId,
		workspaceId: fixture.workspaceId,
	});
	fixture.service.closeTab({ chatTabId: bound.id });

	const worktreeRoot = '/tmp/ensemblr/tab-service/worktree';
	const summaryPath = path.join(
		worktreeRoot,
		'.context',
		'sessions',
		`${bound.id}.md`,
	);
	mkdirSync(path.dirname(summaryPath), { recursive: true });
	writeFileSync(summaryPath, '# Written in a worktree\n');
	t.after(() => {
		rmSync(worktreeRoot, { force: true, recursive: true });
	});
	setChatTabMetadata({
		database: fixture.connection.database,
		id: bound.id,
		metadata: {
			summary: { path: summaryPath, title: 'Written in a worktree' },
		},
	});

	const entries = fixture.service.listClosedWithSummary({
		workspaceId: fixture.workspaceId,
	});
	assert.equal(entries.length, 1);
	assert.equal(entries[0]?.summaryPath, summaryPath);
	assert.equal(entries[0]?.summaryTitle, 'Written in a worktree');
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

test('reorderTabs persists a reconciled open-tab sequence', (t) => {
	const fixture = openFixture(t);

	const chat = fixture.service.openTab({
		title: 'Chat',
		workspaceId: fixture.workspaceId,
	});
	const file = fixture.service.openTab({
		kind: 'file',
		metadata: { filePath: 'src/index.ts' },
		title: 'index.ts',
		workspaceId: fixture.workspaceId,
	});
	const diff = fixture.service.openTab({
		kind: 'diff',
		metadata: { filePath: 'src/index.ts' },
		title: 'Diff: index.ts',
		workspaceId: fixture.workspaceId,
	});

	const reordered = fixture.service.reorderTabs({
		orderedIds: [diff.id, 'missing-tab', chat.id, diff.id],
		workspaceId: fixture.workspaceId,
	});

	assert.deepEqual(
		reordered.map((tab) => tab.id),
		[diff.id, chat.id, file.id],
	);
	assert.deepEqual(
		reordered.map((tab) => tab.position),
		[0, 1, 2],
	);
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

test('closeTab archives terminal tabs as restorable, stamping title and metadata', (t) => {
	const fixture = openFixture(t);

	fixture.service.openTab({ workspaceId: fixture.workspaceId });
	const terminalTab = fixture.service.openTab({
		kind: 'terminal',
		metadata: { harnessId: 'claude', terminalId: 'pty-1' },
		title: 'Claude Code',
		workspaceId: fixture.workspaceId,
	});

	// Terminal tabs are archived (restorable), not hard-deleted.
	assert.deepEqual(
		fixture.service.closeTab({
			chatTabId: terminalTab.id,
			metadataPatch: { agentSessionId: 'claude-abc' },
			title: 'Fix the auth bug',
		}),
		{ deleted: false },
	);

	const stored = getChatTabById({
		database: fixture.connection.database,
		id: terminalTab.id,
	});
	assert.ok(stored);
	assert.notEqual(stored?.closedAt, null);
	assert.equal(stored?.title, 'Fix the auth bug');
	assert.equal(stored?.metadata.agentSessionId, 'claude-abc');
	// The original harness metadata is preserved through the merge.
	assert.equal(stored?.metadata.harnessId, 'claude');

	const closed = fixture.service.listTabs({
		workspaceId: fixture.workspaceId,
	}).closed;
	assert.equal(closed.length, 1);
	assert.equal(closed[0]?.id, terminalTab.id);
});

test('restoreTab reopens an archived terminal tab', (t) => {
	const fixture = openFixture(t);

	fixture.service.openTab({ workspaceId: fixture.workspaceId });
	const terminalTab = fixture.service.openTab({
		kind: 'terminal',
		metadata: { harnessId: 'codex', terminalId: 'pty-2' },
		title: 'OpenAI Codex',
		workspaceId: fixture.workspaceId,
	});
	fixture.service.closeTab({
		chatTabId: terminalTab.id,
		metadataPatch: { agentSessionId: 'codex-xyz' },
	});

	const restored = fixture.service.restoreTab({ chatTabId: terminalTab.id });
	assert.equal(restored?.id, terminalTab.id);
	assert.equal(restored?.closedAt, null);
	assert.equal(restored?.metadata.agentSessionId, 'codex-xyz');
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
		},
	});

	assert.throws(
		() => service.listTabs({ workspaceId: fixture.workspaceId }),
		/Database is not open/,
	);
});
