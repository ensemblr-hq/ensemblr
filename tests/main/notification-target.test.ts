import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test } from 'vitest';

import { resolveNotificationTarget } from '../../src/main/agent-runtime/notification-target';
import { openEnsemblrDatabase } from '../../src/main/storage/database';
import { createAgentSession } from '../../src/main/storage/repositories/agent-session-repository';
import {
	markClosed,
	openChatTab,
} from '../../src/main/storage/repositories/chat-tab-repository';

interface Fixture {
	agentSessionId: string;
	database: DatabaseSync;
	workspaceId: string;
}

const cleanups: (() => void)[] = [];

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()?.();
	}
});

/** Opens a throwaway database holding one workspace and one agent session. */
function openFixture(): Fixture {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-notify-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'notification-target-test.db'),
	});
	cleanups.push(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-notify', 'notify', 'Notify', '/tmp/ensemblr/notify', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-notify', 'repo-notify', 'notify', 'Vangelis', '/tmp/ensemblr/notify/ws');
`);

	const { session } = createAgentSession({
		database: connection.database,
		input: { cwd: '/tmp/ensemblr/notify/ws', workspaceId: 'ws-notify' },
	});

	return {
		agentSessionId: session.id,
		database: connection.database,
		workspaceId: 'ws-notify',
	};
}

test('names the workspace and the open tab a notification describes', () => {
	const fixture = openFixture();
	const tab = openChatTab({
		database: fixture.database,
		input: {
			agentSessionId: fixture.agentSessionId,
			kind: 'chat',
			title: 'Fix the notifier',
			workspaceId: fixture.workspaceId,
		},
	});

	expect(
		resolveNotificationTarget(
			fixture.database,
			fixture.workspaceId,
			fixture.agentSessionId,
		),
	).toEqual({
		chatTabId: tab.id,
		isSubAgent: false,
		tabTitle: 'Fix the notifier',
		workspaceId: 'ws-notify',
		workspaceName: 'Vangelis',
	});
});

test('drops the tab id when the only tab behind the session is closed', () => {
	const fixture = openFixture();
	const tab = openChatTab({
		database: fixture.database,
		input: {
			agentSessionId: fixture.agentSessionId,
			kind: 'chat',
			title: 'Closed while running',
			workspaceId: fixture.workspaceId,
		},
	});
	markClosed({ database: fixture.database, id: tab.id });

	const target = resolveNotificationTarget(
		fixture.database,
		fixture.workspaceId,
		fixture.agentSessionId,
	);

	expect(target?.chatTabId).toBeNull();
	expect(target?.tabTitle).toBe('Closed while running');
});

test('reports the sub-agent marker off the tab it already read', () => {
	const fixture = openFixture();
	openChatTab({
		database: fixture.database,
		input: {
			agentSessionId: fixture.agentSessionId,
			kind: 'chat',
			metadata: { agentRole: 'subagent' },
			title: 'Spawned child',
			workspaceId: fixture.workspaceId,
		},
	});

	expect(
		resolveNotificationTarget(
			fixture.database,
			fixture.workspaceId,
			fixture.agentSessionId,
		)?.isSubAgent,
	).toBe(true);
});

test('reports null when the database is not open yet', () => {
	expect(resolveNotificationTarget(null, 'ws-notify', 'session-1')).toBeNull();
});

test('falls back to the workspace id when the row has no name', () => {
	const fixture = openFixture();
	fixture.database.exec(
		"UPDATE workspaces SET name = '   ' WHERE id = 'ws-notify';",
	);
	openChatTab({
		database: fixture.database,
		input: {
			agentSessionId: fixture.agentSessionId,
			kind: 'chat',
			title: 'Unnamed workspace',
			workspaceId: fixture.workspaceId,
		},
	});

	expect(
		resolveNotificationTarget(
			fixture.database,
			fixture.workspaceId,
			fixture.agentSessionId,
		)?.workspaceName,
	).toBe('ws-notify');
});
