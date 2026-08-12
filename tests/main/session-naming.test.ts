import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, test } from 'vitest';

import type { AgentSession } from '../../src/main/agent-runtime/agent-client.ts';
import { createSessionNaming } from '../../src/main/agent-runtime/naming/session-naming.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import {
	createAgentSession,
	createTurn,
} from '../../src/main/storage/repositories/agent-session-repository.ts';
import {
	getChatTabById,
	openChatTab,
	setChatTabMetadata,
} from '../../src/main/storage/repositories/chat-tab-repository.ts';

interface Fixture {
	branchId: string;
	chatTabId: string;
	database: DatabaseSync;
	sessionId: string;
	workspaceId: string;
}

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()?.();
	}
});

function openFixture(): Fixture {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-naming-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'naming-test.db'),
	});
	cleanups.push(() => {
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
			 VALUES ('ws-n', 'repo-n', 'n', 'N', '/tmp/ensemblr/n/ws', 'octocat/placeholder', '{}')`,
		)
		.run();

	const { mainBranch, session } = createAgentSession({
		database,
		input: {
			cwd: '/tmp/ensemblr/n/ws',
			executableId: null,
			executablePath: null,
			label: null,
			metadata: {},
			model: null,
			runtimeSessionId: 'native-n',
			thinkingLevel: null,
			workspaceId: 'ws-n',
		},
	});
	const tab = openChatTab({
		database,
		input: {
			kind: 'chat',
			agentSessionId: session.id,
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

/** A live-session stub that reports the given Pi session name via `get_state`. */
function liveSessionWithName(sessionName: string | null): AgentSession {
	return {
		getState: async () => ({ sessionName }),
	} as unknown as AgentSession;
}

/** A live-session stub whose `get_state` rejects, exercising the fallback path. */
function liveSessionThatFailsState(): AgentSession {
	return {
		getState: async () => {
			throw new Error('get_state unavailable');
		},
	} as unknown as AgentSession;
}

function baseInput(
	fixture: Fixture,
	initialPrompt: string | null,
	liveSession: AgentSession | null = null,
) {
	return {
		branchId: fixture.branchId,
		chatTabId: fixture.chatTabId,
		database: fixture.database,
		eventSink: undefined,
		initialPrompt,
		liveSession,
		sessionId: fixture.sessionId,
		workspaceId: fixture.workspaceId,
	};
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
	expect(getChatTabById({ database, id: chatTabId })?.title).toBe(title);
}

/** Lets the fire-and-forget titling attempt settle before reading the tab. */
async function settle(): Promise<void> {
	await delay(20);
}

describe('createSessionNaming', () => {
	test('derives the tab title from the first message', async () => {
		const fixture = openFixture();

		createSessionNaming()(baseInput(fixture, 'Fix the login redirect bug'));
		await waitForTitle(
			fixture.database,
			fixture.chatTabId,
			'Fix the login redirect bug',
		);

		const tab = getChatTabById({
			database: fixture.database,
			id: fixture.chatTabId,
		});
		expect(tab?.metadata.titleProvenance).toBe('auto');
		expect(tab?.metadata.titleAutoNamed).toBe(true);
	});

	test('drops a leading slash command so the title describes the work', async () => {
		const fixture = openFixture();

		createSessionNaming()(baseInput(fixture, '/skill:caveman write a haiku'));
		await waitForTitle(fixture.database, fixture.chatTabId, 'write a haiku');
	});

	test('strips the master-prompt wrapper before deriving', async () => {
		const fixture = openFixture();
		const wrapped =
			'<user_preferences>\nBe concise.\n</user_preferences>\n\nAdd a dark mode toggle';

		createSessionNaming()(baseInput(fixture, wrapped));
		await waitForTitle(
			fixture.database,
			fixture.chatTabId,
			'Add a dark mode toggle',
		);
	});

	test('recovers the prompt from the first persisted turn on an idle retry', async () => {
		const fixture = openFixture();
		createTurn({
			database: fixture.database,
			input: {
				branchId: fixture.branchId,
				promptText: 'Wire up the naming path',
			},
		});

		createSessionNaming()(baseInput(fixture, null));
		await waitForTitle(
			fixture.database,
			fixture.chatTabId,
			'Wire up the naming path',
		);
	});

	test("prefers the user's Pi session name and marks it theirs", async () => {
		const fixture = openFixture();

		createSessionNaming()(
			baseInput(
				fixture,
				'Fix the login redirect bug',
				liveSessionWithName('Auth cleanup'),
			),
		);
		await waitForTitle(fixture.database, fixture.chatTabId, 'Auth cleanup');

		const tab = getChatTabById({
			database: fixture.database,
			id: fixture.chatTabId,
		});
		expect(tab?.metadata.titleProvenance).toBe('user');
	});

	test('falls back to the message when get_state rejects', async () => {
		const fixture = openFixture();

		createSessionNaming()(
			baseInput(
				fixture,
				'Fix the login redirect bug',
				liveSessionThatFailsState(),
			),
		);
		await waitForTitle(
			fixture.database,
			fixture.chatTabId,
			'Fix the login redirect bug',
		);
	});

	test('is idempotent: a second attempt leaves a settled title alone', async () => {
		const fixture = openFixture();
		const queue = createSessionNaming();

		queue(baseInput(fixture, 'Fix the login redirect bug'));
		await waitForTitle(
			fixture.database,
			fixture.chatTabId,
			'Fix the login redirect bug',
		);
		queue(baseInput(fixture, 'A completely different request'));
		await settle();

		expect(
			getChatTabById({ database: fixture.database, id: fixture.chatTabId })
				?.title,
		).toBe('Fix the login redirect bug');
	});

	test('never overwrites a title the user chose', async () => {
		const fixture = openFixture();
		setChatTabMetadata({
			database: fixture.database,
			id: fixture.chatTabId,
			metadata: { titleProvenance: 'user' },
		});

		createSessionNaming()(baseInput(fixture, 'Fix the login redirect bug'));
		await settle();

		expect(
			getChatTabById({ database: fixture.database, id: fixture.chatTabId })
				?.title,
		).toBe('New chat');
	});

	test('never overwrites a title the agent chose', async () => {
		const fixture = openFixture();
		setChatTabMetadata({
			database: fixture.database,
			id: fixture.chatTabId,
			metadata: { titleProvenance: 'agent' },
		});

		createSessionNaming()(baseInput(fixture, 'Fix the login redirect bug'));
		await settle();

		expect(
			getChatTabById({ database: fixture.database, id: fixture.chatTabId })
				?.title,
		).toBe('New chat');
	});

	test('drops an overlapping attempt for the same tab', async () => {
		const fixture = openFixture();
		const queue = createSessionNaming();

		queue(baseInput(fixture, 'Fix the login redirect bug'));
		queue(baseInput(fixture, 'A completely different request'));
		await waitForTitle(
			fixture.database,
			fixture.chatTabId,
			'Fix the login redirect bug',
		);
	});

	test('leaves the tab alone when the prompt is pure scaffolding', async () => {
		const fixture = openFixture();

		createSessionNaming()(
			baseInput(
				fixture,
				'<user_preferences>\nBe concise.\n</user_preferences>',
			),
		);
		await settle();

		expect(
			getChatTabById({ database: fixture.database, id: fixture.chatTabId })
				?.title,
		).toBe('New chat');
	});
});
