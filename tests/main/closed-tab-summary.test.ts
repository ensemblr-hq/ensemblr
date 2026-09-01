/// <reference types="node" />

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createAgentClient } from '../../src/main/agent-runtime/agent-client.ts';
import { createAgentSessionService } from '../../src/main/agent-runtime/agent-session-service.ts';
import { createFakeAgentAdapter } from '../../src/main/agent-runtime/fake-agent-adapter.ts';
import { createSessionSummaryWriter } from '../../src/main/agent-runtime/session-summary-writer.ts';
import { createChatTabService } from '../../src/main/chat-tabs/chat-tab-service.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import {
	type EnsemblrDatabaseService,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';
import { getChatTabById } from '../../src/main/storage/repositories/chat-tab-repository.ts';

function readyExecutable(): PiExecutableSnapshot {
	return {
		command: '/usr/local/bin/pi',
		diagnostics: [],
		displayPath: '/usr/local/bin/pi',
		path: '/usr/local/bin/pi',
		probe: null,
		setting: null,
		source: null,
		status: 'ok',
		updatedAt: '2026-06-08T00:00:00.000Z',
	};
}

function databaseServiceFor(database: DatabaseSync): EnsemblrDatabaseService {
	const connection = { database, path: ':memory:', schemaVersion: 5 };
	return {
		close: () => undefined,
		getConnection: () => connection,
		getHealth: () => ({ path: ':memory:', schemaVersion: 5, status: 'ok' }),
		open: () => ({ path: ':memory:', schemaVersion: 5, status: 'ok' }),
	};
}

function openFixture(t: import('node:test').TestContext): {
	database: DatabaseSync;
	workspaceCwd: string;
	workspaceId: string;
} {
	const directory = mkdtempSync(
		path.join(tmpdir(), 'ensemblr-closed-summary-'),
	);
	const workspaceCwd = path.join(directory, 'ws');
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'closed-summary.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});
	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-cs', 'cs', 'ClosedSummary', '${directory}', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('ws-cs', 'repo-cs', 'cs', 'ClosedSummary', '${workspaceCwd}');
`);
	return {
		database: connection.database,
		workspaceCwd,
		workspaceId: 'ws-cs',
	};
}

/**
 * Drives a workspace up to "one chat has produced an agent turn", with the
 * summary writer gated so a test decides when the file reaches disk.
 */
async function openChattedSession(
	t: import('node:test').TestContext,
	options: {
		onSummaryPersisted?: (input: { workspaceId: string }) => void;
	} = {},
) {
	const fixture = openFixture(t);
	let releaseWrite = (): void => undefined;
	const writeGate = new Promise<void>((resolve) => {
		releaseWrite = () => resolve();
	});
	const sessionSummaryWriter = createSessionSummaryWriter({
		writeFile: async (filePath, contents) => {
			await writeGate;
			const { writeFile } = await import('node:fs/promises');
			await writeFile(filePath, contents, 'utf8');
		},
	});

	const fake = createFakeAgentAdapter();
	const databaseService = databaseServiceFor(fixture.database);
	const agentSessionService = createAgentSessionService({
		agentClient: createAgentClient({ adapter: fake.adapter }),
		databaseService,
		onSummaryPersisted: options.onSummaryPersisted,
		queueNaming: () => undefined,
		sessionSummaryWriter,
	});
	const chatTabService = createChatTabService({
		databaseService,
		lookups: { agentSessionExists: () => true },
	});

	const snapshot = await agentSessionService.openSession({
		executable: readyExecutable(),
		workspaceCwd: fixture.workspaceCwd,
		workspaceId: fixture.workspaceId,
	});
	const chatTabId = snapshot.openedTabs[0]?.id;
	assert.ok(chatTabId, 'expected the session to open a chat tab');

	// The min-one-open-chat rule refuses to close the only chat in a workspace.
	chatTabService.openTab({ workspaceId: fixture.workspaceId });

	await agentSessionService.submitPrompt({
		prompt: 'do the thing',
		sessionId: snapshot.id,
	});
	const runtime = fake.getOpenSessions()[0];
	assert.ok(runtime, 'expected one open runtime session');
	runtime.emit({
		at: '2026-06-08T00:00:01.000Z',
		payload: { kind: 'text', text: 'agent reply' },
		role: 'agent',
		turnId: 'fake-turn',
		type: 'message',
	});

	return {
		agentSessionService,
		chatTabId,
		chatTabService,
		fixture,
		releaseWrite,
		runtime,
		sessionId: snapshot.id,
	};
}

/**
 * The summary path recorded on a tab's own row, which is where a write lands
 * while the tab is still open — closed-tab history cannot see it yet.
 */
function markedSummaryPath(
	database: DatabaseSync,
	chatTabId: string,
): string | null {
	const tab = getChatTabById({ database, id: chatTabId });
	const summary = tab?.metadata.summary as { path?: unknown } | undefined;
	return typeof summary?.path === 'string' ? summary.path : null;
}

function summaryPathFor(
	chatTabService: ReturnType<typeof createChatTabService>,
	workspaceId: string,
	chatTabId: string,
): string | null {
	const entry = chatTabService
		.listClosedWithSummary({ workspaceId })
		.find((row) => row.tab.id === chatTabId);
	return entry ? entry.summaryPath : null;
}

test('closing a chat flushes the summary its live session still owes', async (t) => {
	const chat = await openChattedSession(t);
	chat.releaseWrite();

	// The close path's flush, which the IPC handler awaits before archiving. No
	// idle event ever arrived, so nothing else would have written this turn.
	await chat.agentSessionService.flushSummaryForChatTab(chat.chatTabId);
	chat.chatTabService.closeTab({ chatTabId: chat.chatTabId });

	const summaryPath = summaryPathFor(
		chat.chatTabService,
		chat.fixture.workspaceId,
		chat.chatTabId,
	);
	assert.ok(
		summaryPath?.endsWith(`${chat.chatTabId}.md`),
		'the archived tab carries the transcript the close flushed',
	);
});

test('a summary that lands after the close announces itself', async (t) => {
	const refreshed: string[] = [];
	const chat = await openChattedSession(t, {
		onSummaryPersisted: ({ workspaceId }) => refreshed.push(workspaceId),
	});

	// The stop backgrounds its flush deliberately, so the close answers first and
	// the renderer's refetch sees a tab with no transcript yet.
	await chat.agentSessionService.stopSession({ sessionId: chat.sessionId });
	chat.chatTabService.closeTab({ chatTabId: chat.chatTabId });
	assert.equal(
		summaryPathFor(
			chat.chatTabService,
			chat.fixture.workspaceId,
			chat.chatTabId,
		),
		'',
		'the write is still in flight at the moment the close resolves',
	);

	chat.releaseWrite();
	for (let attempt = 0; attempt < 60 && refreshed.length === 0; attempt += 1) {
		await delay(10);
	}
	assert.deepEqual(
		refreshed,
		[chat.fixture.workspaceId],
		'the landed summary must announce itself, or the blank result is cached forever',
	);
	assert.ok(
		summaryPathFor(
			chat.chatTabService,
			chat.fixture.workspaceId,
			chat.chatTabId,
		)?.endsWith(`${chat.chatTabId}.md`),
		'the refetch that announcement triggers finds the transcript',
	);
});

test('a plain turn boundary writes its summary without announcing', async (t) => {
	const refreshed: string[] = [];
	const chat = await openChattedSession(t, {
		onSummaryPersisted: ({ workspaceId }) => refreshed.push(workspaceId),
	});
	chat.releaseWrite();

	// The tab is open and live, so nothing the renderer cached is stale. Every
	// listener fire costs each window a refetch of the closed-tab list, which
	// stats the summary file of every closed tab in the workspace on the main
	// thread — per turn, for a surface no turn boundary changes.
	chat.runtime.setStatus('idle');
	for (
		let attempt = 0;
		attempt < 60 && !markedSummaryPath(chat.fixture.database, chat.chatTabId);
		attempt += 1
	) {
		await delay(10);
	}

	// The tab is still open, so the write shows up as the marker on its row
	// rather than in the closed-tab history.
	assert.ok(
		markedSummaryPath(chat.fixture.database, chat.chatTabId)?.endsWith(
			`${chat.chatTabId}.md`,
		),
		'the turn boundary still writes the summary — only the announcement is scoped',
	);
	assert.deepEqual(refreshed, [], 'a turn-idle write must stay silent');

	// Only once a flush path asks for it does the same write announce.
	chat.runtime.emit({
		at: '2026-06-08T00:00:02.000Z',
		payload: { kind: 'text', text: 'second reply' },
		role: 'agent',
		turnId: 'fake-turn-2',
		type: 'message',
	});
	await chat.agentSessionService.flushSummaryForChatTab(chat.chatTabId);

	assert.deepEqual(
		refreshed,
		[chat.fixture.workspaceId],
		'the flush the close path runs is what announces',
	);
});
