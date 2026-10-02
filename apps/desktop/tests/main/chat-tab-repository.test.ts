/// <reference types="node" />

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import { createAgentSession } from '../../src/main/storage/repositories/agent-session-repository.ts';
import {
	bindAgentSession,
	closeChatTab,
	deleteChatTab,
	getChatTabByAgentSessionId,
	getRuntimeState,
	listChatTabsAcrossWorkspaces,
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

interface Fixture {
	agentSessionId: string;
	database: DatabaseSync;
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

	const { session } = createAgentSession({
		database: connection.database,
		input: { cwd: '/tmp/ensemblr/tab/ws', workspaceId: 'ws-tab' },
	});

	return {
		database: connection.database,
		agentSessionId: session.id,
		workspaceId: 'ws-tab',
	};
}

test('openChatTab assigns sequential positions to open tabs', (t) => {
	const fixture = openFixture(t);

	const a = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			agentSessionId: fixture.agentSessionId,
			title: 'Chat A',
			workspaceId: fixture.workspaceId,
		},
	});
	const b = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			agentSessionId: fixture.agentSessionId,
			title: 'Chat B',
			workspaceId: fixture.workspaceId,
		},
	});

	assert.equal(a.position, 0);
	assert.equal(b.position, 1);
	assert.equal(b.kind, 'chat');
	assert.equal(b.closedAt, null);
});

test('openChatTab places a tab right of the anchor and shifts later tabs', (t) => {
	const fixture = openFixture(t);

	const first = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			title: 'Chat A',
			workspaceId: fixture.workspaceId,
		},
	});
	const last = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			title: 'Chat B',
			workspaceId: fixture.workspaceId,
		},
	});

	const inserted = openChatTab({
		database: fixture.database,
		input: {
			insertAfterChatTabId: first.id,
			kind: 'file',
			title: 'notes.md',
			workspaceId: fixture.workspaceId,
		},
	});

	assert.equal(inserted.position, 1);
	assert.deepEqual(
		listOpenChatTabs({
			database: fixture.database,
			workspaceId: fixture.workspaceId,
		}).map((tab) => tab.id),
		[first.id, inserted.id, last.id],
	);
	assert.equal(
		listOpenChatTabs({
			database: fixture.database,
			workspaceId: fixture.workspaceId,
		}).find((tab) => tab.id === last.id)?.position,
		2,
	);
});

test('openChatTab appends when the anchor is not an open tab', (t) => {
	const fixture = openFixture(t);

	const first = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			title: 'Chat A',
			workspaceId: fixture.workspaceId,
		},
	});
	const closed = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			title: 'Chat B',
			workspaceId: fixture.workspaceId,
		},
	});
	closeChatTab({ database: fixture.database, id: closed.id });

	const afterClosed = openChatTab({
		database: fixture.database,
		input: {
			insertAfterChatTabId: closed.id,
			kind: 'file',
			title: 'notes.md',
			workspaceId: fixture.workspaceId,
		},
	});
	const afterUnknown = openChatTab({
		database: fixture.database,
		input: {
			insertAfterChatTabId: 'missing-tab',
			kind: 'file',
			title: 'other.md',
			workspaceId: fixture.workspaceId,
		},
	});

	assert.deepEqual(
		listOpenChatTabs({
			database: fixture.database,
			workspaceId: fixture.workspaceId,
		}).map((tab) => tab.id),
		[first.id, afterClosed.id, afterUnknown.id],
	);
});

test('closeChatTab leaves the row but flags closed_at', (t) => {
	const fixture = openFixture(t);

	const tab = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			agentSessionId: fixture.agentSessionId,
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

test('preview tabs can omit agent_session_id', (t) => {
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
	assert.equal(tab.agentSessionId, null);
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
			agentSessionId: fixture.agentSessionId,
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

test('openChatTab defaults fullTitle to title when none is supplied', (t) => {
	const fixture = openFixture(t);

	const tab = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			agentSessionId: fixture.agentSessionId,
			title: 'Short',
			workspaceId: fixture.workspaceId,
		},
	});

	assert.equal(tab.fullTitle, 'Short');
});

test('openChatTab keeps a supplied fullTitle alongside the capped title', (t) => {
	const fixture = openFixture(t);

	const tab = openChatTab({
		database: fixture.database,
		input: {
			fullTitle: 'Migration Architect: Next.js App Router upgrade',
			kind: 'chat',
			agentSessionId: fixture.agentSessionId,
			title: 'Migration Architect: Next.js…',
			workspaceId: fixture.workspaceId,
		},
	});

	assert.equal(tab.title, 'Migration Architect: Next.js…');
	assert.equal(
		tab.fullTitle,
		'Migration Architect: Next.js App Router upgrade',
	);
});

test('renameChatTab rewrites fullTitle so a stale one never survives', (t) => {
	const fixture = openFixture(t);

	const tab = openChatTab({
		database: fixture.database,
		input: {
			fullTitle: 'The original untruncated title',
			kind: 'chat',
			agentSessionId: fixture.agentSessionId,
			title: 'The original…',
			workspaceId: fixture.workspaceId,
		},
	});

	const renamed = renameChatTab({
		database: fixture.database,
		id: tab.id,
		title: 'Renamed',
	});

	assert.equal(renamed?.fullTitle, 'Renamed');
});

test('listOpenForWorkspace mirrors listOpenChatTabs', (t) => {
	const fixture = openFixture(t);

	openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			agentSessionId: fixture.agentSessionId,
			title: 'Alpha',
			workspaceId: fixture.workspaceId,
		},
	});
	openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			agentSessionId: fixture.agentSessionId,
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
			agentSessionId: fixture.agentSessionId,
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

test('bindAgentSession attaches an agent session to a tab', (t) => {
	const fixture = openFixture(t);

	const tab = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			title: 'Unbound',
			workspaceId: fixture.workspaceId,
		},
	});
	assert.equal(tab.agentSessionId, null);

	const bound = bindAgentSession({
		database: fixture.database,
		id: tab.id,
		agentSessionId: fixture.agentSessionId,
	});
	assert.equal(bound?.agentSessionId, fixture.agentSessionId);
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
			agentSessionId: fixture.agentSessionId,
			title: 'Chat',
			workspaceId: fixture.workspaceId,
		},
	});

	const set = setRuntimeState({
		activeTabId: tab.id,
		database: fixture.database,
		lastActiveSessionId: fixture.agentSessionId,
		workspaceId: fixture.workspaceId,
	});
	assert.equal(set.activeTabId, tab.id);
	assert.equal(set.lastActiveSessionId, fixture.agentSessionId);

	const cleared = setRuntimeState({
		activeTabId: null,
		database: fixture.database,
		lastActiveSessionId: null,
		workspaceId: fixture.workspaceId,
	});
	assert.equal(cleared.activeTabId, null);
});

test('bindAgentSession moves a session, clearing the tab that held it', (t) => {
	const fixture = openFixture(t);

	const first = openChatTab({
		database: fixture.database,
		input: {
			agentSessionId: fixture.agentSessionId,
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

	const bound = bindAgentSession({
		database: fixture.database,
		id: second.id,
		agentSessionId: fixture.agentSessionId,
	});

	assert.equal(bound?.agentSessionId, fixture.agentSessionId);
	const tabs = listOpenChatTabs({
		database: fixture.database,
		workspaceId: fixture.workspaceId,
	});
	assert.deepEqual(
		tabs
			.filter((tab) => tab.agentSessionId === fixture.agentSessionId)
			.map((tab) => tab.id),
		[second.id],
	);
	assert.equal(tabs.find((tab) => tab.id === first.id)?.agentSessionId, null);
});

test('rebinding a session to the tab already holding it is a no-op', (t) => {
	const fixture = openFixture(t);

	const tab = openChatTab({
		database: fixture.database,
		input: {
			agentSessionId: fixture.agentSessionId,
			kind: 'chat',
			title: 'Only',
			workspaceId: fixture.workspaceId,
		},
	});

	const bound = bindAgentSession({
		database: fixture.database,
		id: tab.id,
		agentSessionId: fixture.agentSessionId,
	});

	assert.equal(bound?.agentSessionId, fixture.agentSessionId);
});

test('bindAgentSession leaves an archived tab pointing at the moved session', (t) => {
	const fixture = openFixture(t);

	const archived = openChatTab({
		database: fixture.database,
		input: {
			agentSessionId: fixture.agentSessionId,
			kind: 'chat',
			title: 'Archived',
			workspaceId: fixture.workspaceId,
		},
	});
	closeChatTab({ database: fixture.database, id: archived.id });
	const resumed = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			title: 'Resumed',
			workspaceId: fixture.workspaceId,
		},
	});

	bindAgentSession({
		database: fixture.database,
		id: resumed.id,
		agentSessionId: fixture.agentSessionId,
	});

	// An archived tab is not a second surface, so it keeps its history link; the
	// restore path re-applies the one-surface rule if it ever reopens.
	const stillArchived = listClosedForWorkspace({
		database: fixture.database,
		workspaceId: fixture.workspaceId,
	}).find((tab) => tab.id === archived.id);
	assert.equal(stillArchived?.agentSessionId, fixture.agentSessionId);
});

test('restoreChatTab detaches a session another open tab now holds', (t) => {
	const fixture = openFixture(t);

	const archived = openChatTab({
		database: fixture.database,
		input: {
			agentSessionId: fixture.agentSessionId,
			kind: 'chat',
			title: 'Archived',
			workspaceId: fixture.workspaceId,
		},
	});
	closeChatTab({ database: fixture.database, id: archived.id });

	const resumed = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			title: 'Resumed',
			workspaceId: fixture.workspaceId,
		},
	});
	bindAgentSession({
		database: fixture.database,
		id: resumed.id,
		agentSessionId: fixture.agentSessionId,
	});

	const restored = restoreChatTab({
		database: fixture.database,
		id: archived.id,
	});

	assert.equal(restored?.agentSessionId, null);
	const tabs = listOpenChatTabs({
		database: fixture.database,
		workspaceId: fixture.workspaceId,
	});
	assert.deepEqual(
		tabs
			.filter((tab) => tab.agentSessionId === fixture.agentSessionId)
			.map((tab) => tab.id),
		[resumed.id],
	);
});

test('restoreChatTab keeps a session no other open tab claims', (t) => {
	const fixture = openFixture(t);

	const archived = openChatTab({
		database: fixture.database,
		input: {
			agentSessionId: fixture.agentSessionId,
			kind: 'chat',
			title: 'Archived',
			workspaceId: fixture.workspaceId,
		},
	});
	closeChatTab({ database: fixture.database, id: archived.id });

	const restored = restoreChatTab({
		database: fixture.database,
		id: archived.id,
	});

	assert.equal(restored?.agentSessionId, fixture.agentSessionId);
});

test('getChatTabByAgentSessionId prefers the open tab over a closed one', (t) => {
	const fixture = openFixture(t);

	const stale = openChatTab({
		database: fixture.database,
		input: {
			agentSessionId: fixture.agentSessionId,
			kind: 'chat',
			title: 'Stale',
			workspaceId: fixture.workspaceId,
		},
	});
	closeChatTab({ database: fixture.database, id: stale.id });

	const live = openChatTab({
		database: fixture.database,
		input: {
			kind: 'chat',
			title: 'Live',
			workspaceId: fixture.workspaceId,
		},
	});
	// A legacy database can already hold the duplicate binding the bind path now
	// prevents, so the lookup is exercised against one written behind its back.
	fixture.database
		.prepare(`UPDATE chat_tabs SET agent_session_id = ? WHERE id = ?`)
		.run(fixture.agentSessionId, live.id);

	const found = getChatTabByAgentSessionId({
		agentSessionId: fixture.agentSessionId,
		database: fixture.database,
	});

	assert.equal(found?.id, live.id);
});

test('listChatTabsAcrossWorkspaces spans every workspace and caps closed tabs', (t) => {
	const fixture = openFixture(t);
	fixture.database.exec(`
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-other', 'repo-tab', 'other', 'Other', '/tmp/ensemblr/tab/other');
`);

	const openTab = (workspaceId: string, title: string) =>
		openChatTab({
			database: fixture.database,
			input: { kind: 'chat', title, workspaceId },
		});

	const here = openTab(fixture.workspaceId, 'Here');
	const elsewhere = openTab('ws-other', 'Elsewhere');
	const first = openTab(fixture.workspaceId, 'First closed');
	const second = openTab('ws-other', 'Second closed');
	closeChatTab({ database: fixture.database, id: first.id });
	closeChatTab({ database: fixture.database, id: second.id });

	const all = listChatTabsAcrossWorkspaces({
		closedLimit: 10,
		database: fixture.database,
	});
	assert.deepEqual(
		new Set(all.open.map((tab) => tab.id)),
		new Set([here.id, elsewhere.id]),
	);
	assert.deepEqual(
		new Set(all.closed.map((tab) => tab.id)),
		new Set([first.id, second.id]),
	);

	const capped = listChatTabsAcrossWorkspaces({
		closedLimit: 1,
		database: fixture.database,
	});
	assert.equal(capped.closed.length, 1);
	assert.equal(capped.open.length, 2);
});
