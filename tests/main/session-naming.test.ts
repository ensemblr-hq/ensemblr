/// <reference types="node" />

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import type { AppSettingsService } from '../../src/main/config';
import {
	createFakePiAgentAdapter,
	type FakePiAgentAdapterController,
	type FakePiAgentAdapterSessionController,
} from '../../src/main/pi-agent/fake-pi-agent-client.ts';
import { createSessionNaming } from '../../src/main/pi-agent/naming/session-naming.ts';
import { createPiAgentClient } from '../../src/main/pi-agent/pi-agent-client.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import type { RenameWorkspaceService } from '../../src/main/repository';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import {
	getChatTabById,
	openChatTab,
	setChatTabMetadata,
} from '../../src/main/storage/repositories/chat-tab-repository.ts';
import { createPiSession } from '../../src/main/storage/repositories/pi-session-repository.ts';
import type { RenameWorkspaceRequest } from '../../src/shared/ipc/contracts/workspace';

interface Fixture {
	branchId: string;
	chatTabId: string;
	database: DatabaseSync;
	sessionId: string;
	workspaceId: string;
}

function openFixture(
	t: TestContext,
	workspaceMetadata: Record<string, unknown> = {},
): Fixture {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-naming-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'naming-test.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});
	const database = connection.database;
	database
		.prepare(
			`INSERT INTO repositories (id, slug, name, path, default_branch)
			 VALUES ('repo-n', 'n', 'N', '/tmp/ensemblr/n', 'main')`,
		)
		.run();
	database
		.prepare(
			`INSERT INTO workspaces (id, repository_id, slug, name, path, branch_name, metadata_json)
			 VALUES ('ws-n', 'repo-n', 'n', 'N', '/tmp/ensemblr/n/ws', 'psoldunov/placeholder', ?)`,
		)
		.run(JSON.stringify(workspaceMetadata));

	const { mainBranch, session } = createPiSession({
		database,
		input: {
			cwd: '/tmp/ensemblr/n/ws',
			executableId: null,
			executablePath: null,
			label: null,
			metadata: {},
			model: null,
			piSessionId: 'native-n',
			thinkingLevel: null,
			workspaceId: 'ws-n',
		},
	});
	const tab = openChatTab({
		database,
		input: {
			kind: 'chat',
			piSessionId: session.id,
			title: 'New chat',
			workspaceId: 'ws-n',
		},
	});
	return {
		branchId: mainBranch.id,
		chatTabId: tab.id,
		database,
		sessionId: session.id,
		workspaceId: 'ws-n',
	};
}

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

function settingsStub(renameWorkspaceOnBranch: boolean): AppSettingsService {
	return {
		read: () => ({ git: { renameWorkspaceOnBranch } }),
	} as unknown as AppSettingsService;
}

/** Waits for the ephemeral naming session to be created and subscribed. */
async function waitForNamingSession(
	fake: FakePiAgentAdapterController,
): Promise<FakePiAgentAdapterSessionController> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const session = fake.getOpenSessions()[0];
		if (session && session.listenerCount() > 0) {
			return session;
		}
		await delay(2);
	}
	throw new Error('naming session was never created');
}

/** Drives the naming session to reply with the given raw text, then go idle. */
function replyAndSettle(
	session: FakePiAgentAdapterSessionController,
	text: string,
): void {
	session.emit({
		at: '2026-06-08T00:00:01.000Z',
		payload: { kind: 'text', text },
		role: 'agent',
		turnId: 'naming-turn',
		type: 'message',
	});
	session.setStatus('idle');
}

async function waitForTitle(
	database: DatabaseSync,
	chatTabId: string,
	title: string,
): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (getChatTabById({ database, id: chatTabId })?.title === title) {
			return;
		}
		await delay(2);
	}
	assert.equal(getChatTabById({ database, id: chatTabId })?.title, title);
}

function baseInput(fixture: Fixture, initialPrompt: string | null) {
	return {
		branchId: fixture.branchId,
		chatTabId: fixture.chatTabId,
		database: fixture.database,
		eventSink: undefined,
		executable: readyExecutable(),
		initialPrompt,
		model: null,
		sessionId: fixture.sessionId,
		workspaceCwd: '/tmp/ensemblr/n/ws',
		workspaceId: fixture.workspaceId,
	};
}

test('names the tab from a TITLE line and stamps auto provenance', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakePiAgentAdapter();
	const piAgentClient = createPiAgentClient({ adapter: fake.adapter });
	const queueNaming = createSessionNaming({
		appSettingsService: settingsStub(false),
		piAgentClient,
		renameWorkspace: async () => {
			throw new Error('rename must not run when the setting is off');
		},
	});

	queueNaming(baseInput(fixture, 'Rework how tabs are renamed'));
	const naming = await waitForNamingSession(fake);
	replyAndSettle(naming, 'TITLE: Rework tab renaming');

	await waitForTitle(
		fixture.database,
		fixture.chatTabId,
		'Rework tab renaming',
	);
	const tab = getChatTabById({
		database: fixture.database,
		id: fixture.chatTabId,
	});
	assert.equal(tab?.metadata.titleAutoNamed, true);
	assert.equal(tab?.metadata.titleProvenance, 'auto');
});

test('is idempotent: a second attempt after naming spawns no session', async (t) => {
	const fixture = openFixture(t);
	setChatTabMetadata({
		database: fixture.database,
		id: fixture.chatTabId,
		metadata: { titleAutoNamed: true, titleProvenance: 'auto' },
	});
	const fake = createFakePiAgentAdapter();
	const piAgentClient = createPiAgentClient({ adapter: fake.adapter });
	const queueNaming = createSessionNaming({
		appSettingsService: settingsStub(false),
		piAgentClient,
		renameWorkspace: async () => {
			throw new Error('rename must not run');
		},
	});

	queueNaming(baseInput(fixture, 'Some later prompt'));
	await delay(30);
	assert.equal(
		fake.getOpenSessions().length,
		0,
		'no naming session should spawn once the tab is already named',
	);
});

test('drops an overlapping attempt while one is already in flight', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakePiAgentAdapter();
	const piAgentClient = createPiAgentClient({ adapter: fake.adapter });
	const queueNaming = createSessionNaming({
		appSettingsService: settingsStub(false),
		piAgentClient,
		renameWorkspace: async () => {
			throw new Error('rename must not run when the setting is off');
		},
	});

	queueNaming(baseInput(fixture, 'Rework how tabs are renamed'));
	const naming = await waitForNamingSession(fake);
	queueNaming(baseInput(fixture, null));
	await delay(20);
	assert.equal(
		fake.getOpenSessions().length,
		1,
		'the second fire must not spawn a concurrent naming session',
	);

	replyAndSettle(naming, 'TITLE: Rework tab renaming');
	await waitForTitle(
		fixture.database,
		fixture.chatTabId,
		'Rework tab renaming',
	);
});

test('never overwrites a user-owned title', async (t) => {
	const fixture = openFixture(t);
	setChatTabMetadata({
		database: fixture.database,
		id: fixture.chatTabId,
		metadata: { titleProvenance: 'user' },
	});
	const fake = createFakePiAgentAdapter();
	const piAgentClient = createPiAgentClient({ adapter: fake.adapter });
	const queueNaming = createSessionNaming({
		appSettingsService: settingsStub(false),
		piAgentClient,
		renameWorkspace: async () => {
			throw new Error('rename must not run');
		},
	});

	queueNaming(baseInput(fixture, 'Prompt that would normally rename'));
	await delay(30);
	assert.equal(fake.getOpenSessions().length, 0);
	assert.equal(
		getChatTabById({ database: fixture.database, id: fixture.chatTabId })
			?.title,
		'New chat',
	);
});

test('discards a timed-out response and leaves the tab retriable', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakePiAgentAdapter();
	const piAgentClient = createPiAgentClient({ adapter: fake.adapter });
	const queueNaming = createSessionNaming({
		appSettingsService: settingsStub(false),
		piAgentClient,
		renameWorkspace: async () => {
			throw new Error('rename must not run');
		},
		timeoutMs: 20,
	});

	queueNaming(baseInput(fixture, 'A prompt whose naming will time out'));
	const naming = await waitForNamingSession(fake);
	// Reply but never settle to idle: the coordinator must discard the partial.
	naming.emit({
		at: '2026-06-08T00:00:01.000Z',
		payload: { kind: 'text', text: 'TITLE: Half a th' },
		role: 'agent',
		turnId: 'naming-turn',
		type: 'message',
	});
	await delay(60);

	const tab = getChatTabById({
		database: fixture.database,
		id: fixture.chatTabId,
	});
	assert.equal(tab?.title, 'New chat', 'partial title must not be persisted');
	assert.notEqual(tab?.metadata.titleAutoNamed, true);
});

test('renames the workspace branch when the setting is on and placeholder holds', async (t) => {
	const fixture = openFixture(t, { placeholderName: true });
	const fake = createFakePiAgentAdapter();
	const piAgentClient = createPiAgentClient({ adapter: fake.adapter });
	const renameCalls: RenameWorkspaceRequest[] = [];
	const renameWorkspace: RenameWorkspaceService['rename'] = async (request) => {
		renameCalls.push(request);
		return {
			diagnostics: [],
			status: 'success',
			workspace: {
				archivedAt: null,
				baseBranch: 'main',
				branchName: `psoldunov/${request.name}`,
				createdAt: '2026-06-08T00:00:00.000Z',
				id: fixture.workspaceId,
				metadata: {},
				name: request.name ?? '',
				path: '/tmp/ensemblr/n/ws',
				repositoryId: 'repo-n',
				slug: 'n',
				updatedAt: '2026-06-08T00:00:02.000Z',
			},
		};
	};
	const queueNaming = createSessionNaming({
		appSettingsService: settingsStub(true),
		piAgentClient,
		renameWorkspace,
	});

	queueNaming(baseInput(fixture, 'Add a dark mode toggle to settings'));
	const naming = await waitForNamingSession(fake);
	replyAndSettle(naming, 'TITLE: Add dark mode\nBRANCH: add-dark-mode');

	for (
		let attempt = 0;
		attempt < 100 && renameCalls.length === 0;
		attempt += 1
	) {
		await delay(2);
	}
	assert.equal(renameCalls.length, 1);
	assert.equal(renameCalls[0]?.name, 'add-dark-mode');
	assert.equal(renameCalls[0]?.requirePlaceholderName, true);
	assert.equal(renameCalls[0]?.branchName, 'psoldunov/add-dark-mode');
});
