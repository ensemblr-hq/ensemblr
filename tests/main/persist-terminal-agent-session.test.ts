/// <reference types="node" />

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { persistTerminalAgentSessionId } from '../../src/main/chat-tabs/persist-terminal-agent-session.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import {
	getChatTabById,
	openChatTab,
} from '../../src/main/storage/repositories/chat-tab-repository.ts';

const WORKSPACE_ID = 'ws-tab';

function openFixture(t: import('node:test').TestContext): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-persist-agent-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'persist-agent-test.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});

	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-tab', 'tab', 'Tab', '/tmp/ensemblr/tab', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('${WORKSPACE_ID}', 'repo-tab', 'tab', 'Tab', '/tmp/ensemblr/tab/ws');
`);

	return connection.database;
}

test('persists a captured session id onto the terminal tab backing the PTY', (t) => {
	const database = openFixture(t);
	const tab = openChatTab({
		database,
		input: {
			kind: 'terminal',
			metadata: { harnessId: 'claude', terminalId: 'pty-1' },
			piSessionId: null,
			title: 'Claude Code',
			workspaceId: WORKSPACE_ID,
		},
	});

	persistTerminalAgentSessionId({
		agentSessionId: 'session-abc',
		database,
		terminalId: 'pty-1',
		workspaceId: WORKSPACE_ID,
	});

	assert.equal(
		getChatTabById({ database, id: tab.id })?.metadata.agentSessionId,
		'session-abc',
	);
});

test('does not touch a tab whose PTY id does not match', (t) => {
	const database = openFixture(t);
	const tab = openChatTab({
		database,
		input: {
			kind: 'terminal',
			metadata: { harnessId: 'claude', terminalId: 'pty-1' },
			piSessionId: null,
			title: 'Claude Code',
			workspaceId: WORKSPACE_ID,
		},
	});

	persistTerminalAgentSessionId({
		agentSessionId: 'session-abc',
		database,
		terminalId: 'pty-other',
		workspaceId: WORKSPACE_ID,
	});

	assert.equal(
		getChatTabById({ database, id: tab.id })?.metadata.agentSessionId,
		undefined,
	);
});

test('is a no-op when the database is null', () => {
	assert.doesNotThrow(() =>
		persistTerminalAgentSessionId({
			agentSessionId: 'session-abc',
			database: null,
			terminalId: 'pty-1',
			workspaceId: WORKSPACE_ID,
		}),
	);
});
