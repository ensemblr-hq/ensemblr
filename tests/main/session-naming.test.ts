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
import { sanitizeChatTitle } from '../../src/main/pi-agent/naming/sanitize-title.ts';
import { createSessionNaming } from '../../src/main/pi-agent/naming/session-naming.ts';
import type { PiAgentSession } from '../../src/main/pi-agent/pi-agent-client.ts';
import { createPiAgentClient } from '../../src/main/pi-agent/pi-agent-client.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import type { RenameWorkspaceService } from '../../src/main/repository';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import {
	getChatTabById,
	openChatTab,
	setChatTabMetadata,
} from '../../src/main/storage/repositories/chat-tab-repository.ts';
import {
	createPiSession,
	createTurn,
} from '../../src/main/storage/repositories/pi-session-repository.ts';
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

/** A live-session stub that reports the given Pi session name via `get_state`. */
function liveSessionWithName(sessionName: string | null): PiAgentSession {
	return {
		getState: async () => ({ sessionName }),
	} as unknown as PiAgentSession;
}

/** A live-session stub whose `get_state` rejects, exercising the fallback path. */
function liveSessionThatFailsState(): PiAgentSession {
	return {
		getState: async () => {
			throw new Error('get_state unavailable');
		},
	} as unknown as PiAgentSession;
}

/** Waits for the ephemeral branch-naming session to be created and subscribed. */
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

/** Drives the branch-naming session to reply with the given raw text, then go idle. */
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

function baseInput(
	fixture: Fixture,
	initialPrompt: string | null,
	liveSession: PiAgentSession | null = null,
) {
	return {
		branchId: fixture.branchId,
		chatTabId: fixture.chatTabId,
		database: fixture.database,
		eventSink: undefined,
		executable: readyExecutable(),
		initialPrompt,
		liveSession,
		model: null,
		sessionId: fixture.sessionId,
		workspaceCwd: '/tmp/ensemblr/n/ws',
		workspaceId: fixture.workspaceId,
	};
}

test('derives the tab title from the first message without spawning a session', async (t) => {
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

	await waitForTitle(
		fixture.database,
		fixture.chatTabId,
		'Rework how tabs are renamed',
	);
	assert.equal(
		fake.getOpenSessions().length,
		0,
		'a deterministic title must never spawn an agent session',
	);
	const tab = getChatTabById({
		database: fixture.database,
		id: fixture.chatTabId,
	});
	assert.equal(tab?.metadata.titleAutoNamed, true);
	assert.equal(tab?.metadata.titleProvenance, 'auto');
});

test('prefers the Pi session name over the first message', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakePiAgentAdapter();
	const piAgentClient = createPiAgentClient({ adapter: fake.adapter });
	const queueNaming = createSessionNaming({
		appSettingsService: settingsStub(false),
		piAgentClient,
		renameWorkspace: async () => {
			throw new Error('rename must not run');
		},
	});

	queueNaming(
		baseInput(
			fixture,
			'this first message should be ignored',
			liveSessionWithName('Auth rewrite'),
		),
	);

	await waitForTitle(fixture.database, fixture.chatTabId, 'Auth rewrite');
	assert.equal(fake.getOpenSessions().length, 0);
});

test('falls back to the first message when get_state rejects', async (t) => {
	const fixture = openFixture(t);
	const fake = createFakePiAgentAdapter();
	const piAgentClient = createPiAgentClient({ adapter: fake.adapter });
	const queueNaming = createSessionNaming({
		appSettingsService: settingsStub(false),
		piAgentClient,
		renameWorkspace: async () => {
			throw new Error('rename must not run');
		},
	});

	queueNaming(
		baseInput(fixture, 'Cache auth tokens', liveSessionThatFailsState()),
	);

	await waitForTitle(fixture.database, fixture.chatTabId, 'Cache auth tokens');
	assert.equal(fake.getOpenSessions().length, 0);
});

test('recovers and strips a master-prompt-wrapped first turn', async (t) => {
	const fixture = openFixture(t);
	createTurn({
		database: fixture.database,
		input: {
			branchId: fixture.branchId,
			promptText:
				'<user_preferences>\nBe concise.\n</user_preferences>\n\nFix the login redirect bug',
		},
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

	queueNaming(baseInput(fixture, null));

	await waitForTitle(
		fixture.database,
		fixture.chatTabId,
		'Fix the login redirect bug',
	);
	assert.equal(fake.getOpenSessions().length, 0);
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

test('drops an overlapping attempt while a branch naming is in flight', async (t) => {
	const fixture = openFixture(t, { placeholderName: true });
	const fake = createFakePiAgentAdapter();
	const piAgentClient = createPiAgentClient({ adapter: fake.adapter });
	const queueNaming = createSessionNaming({
		appSettingsService: settingsStub(true),
		piAgentClient,
		renameWorkspace: async () => ({
			diagnostics: [],
			status: 'success',
			workspace: {
				archivedAt: null,
				baseBranch: 'main',
				branchName: 'psoldunov/add-dark-mode',
				createdAt: '2026-06-08T00:00:00.000Z',
				id: fixture.workspaceId,
				metadata: {},
				name: 'add-dark-mode',
				path: '/tmp/ensemblr/n/ws',
				repositoryId: 'repo-n',
				slug: 'n',
				updatedAt: '2026-06-08T00:00:02.000Z',
			},
		}),
	});

	queueNaming(baseInput(fixture, 'Add a dark mode toggle to settings'));
	await waitForNamingSession(fake);
	queueNaming(baseInput(fixture, null));
	await delay(20);
	assert.equal(
		fake.getOpenSessions().length,
		1,
		'the second fire must not spawn a concurrent branch naming session',
	);
});

test('discards a timed-out branch response but keeps the deterministic title', async (t) => {
	const fixture = openFixture(t, { placeholderName: true });
	const fake = createFakePiAgentAdapter();
	const piAgentClient = createPiAgentClient({ adapter: fake.adapter });
	const renameCalls: RenameWorkspaceRequest[] = [];
	const renameWorkspace: RenameWorkspaceService['rename'] = async (request) => {
		renameCalls.push(request);
		throw new Error('rename must not run for a timed-out branch');
	};
	const queueNaming = createSessionNaming({
		appSettingsService: settingsStub(true),
		piAgentClient,
		renameWorkspace,
		timeoutMs: 20,
	});

	queueNaming(baseInput(fixture, 'Add dark mode toggle'));
	const naming = await waitForNamingSession(fake);
	// Reply but never settle to idle: the coordinator must discard the partial.
	naming.emit({
		at: '2026-06-08T00:00:01.000Z',
		payload: { kind: 'text', text: 'BRANCH: add-dark' },
		role: 'agent',
		turnId: 'naming-turn',
		type: 'message',
	});
	await delay(60);

	assert.equal(renameCalls.length, 0, 'a timed-out branch must not rename');
	assert.equal(
		getChatTabById({ database: fixture.database, id: fixture.chatTabId })
			?.title,
		'Add dark mode toggle',
		'the deterministic title lands regardless of the branch timeout',
	);
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
	replyAndSettle(naming, 'BRANCH: add-dark-mode');

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
	assert.equal(
		getChatTabById({ database: fixture.database, id: fixture.chatTabId })
			?.title,
		sanitizeChatTitle('Add a dark mode toggle to settings'),
		'the title is derived deterministically alongside the branch rename',
	);
});
