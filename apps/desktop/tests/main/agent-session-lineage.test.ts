import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
	establishAgentSessionLineage,
	listImmediateAgentSessionChildren,
	resolveAgentSessionLineage,
} from '../../src/main/agent-control/session-lineage.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import {
	createAgentSession,
	getAgentSessionById,
	updateAgentSession,
} from '../../src/main/storage/repositories/agent-session-repository.ts';
import {
	bindAgentSession,
	closeChatTab,
	openChatTab,
	setChatTabMetadata,
} from '../../src/main/storage/repositories/chat-tab-repository.ts';

function openFixture(t: import('node:test').TestContext): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-lineage-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'lineage.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});
	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo', 'repo', 'Repo', '/tmp/repo', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES
	('ws-a', 'repo', 'a', 'A', '/tmp/repo/a'),
	('ws-b', 'repo', 'b', 'B', '/tmp/repo/b');
`);
	return connection.database;
}

function createSession(database: DatabaseSync, workspaceId = 'ws-a'): string {
	return createAgentSession({
		database,
		input: { cwd: `/tmp/repo/${workspaceId}`, workspaceId },
	}).session.id;
}

test('persists and resolves a root, child, and leaf using Ensemblr session ids', (t) => {
	const database = openFixture(t);
	const root = createSession(database);
	const child = createSession(database);
	const leaf = createSession(database);

	assert.deepEqual(
		establishAgentSessionLineage({ database, sessionId: root }),
		{ depth: 0, parentSessionId: null, rootSessionId: root },
	);
	assert.deepEqual(
		establishAgentSessionLineage({
			database,
			parentSessionId: root,
			sessionId: child,
		}),
		{ depth: 1, parentSessionId: root, rootSessionId: root },
	);
	assert.deepEqual(
		establishAgentSessionLineage({
			database,
			parentSessionId: child,
			sessionId: leaf,
		}),
		{ depth: 2, parentSessionId: child, rootSessionId: root },
	);

	assert.deepEqual(resolveAgentSessionLineage({ database, sessionId: leaf }), {
		depth: 2,
		parentSessionId: child,
		rootSessionId: root,
	});
	updateAgentSession({
		database,
		id: child,
		patch: { closedAt: '2026-09-10T00:00:00.000Z', status: 'closed' },
	});
	assert.deepEqual(
		listImmediateAgentSessionChildren({ database, parentSessionId: root }),
		[child],
	);
	assert.ok(getAgentSessionById({ database, id: leaf })?.metadata.lineage);
});

test('persists trusted harness ancestry while rejecting arbitrary missing native parents', (t) => {
	const database = openFixture(t);
	const manager = createSession(database);
	const leaf = createSession(database);
	const untrusted = createSession(database);

	assert.deepEqual(
		establishAgentSessionLineage({
			database,
			parentSessionId: 'ws:ws-a',
			parentSpecies: 'harness',
			sessionId: manager,
		}),
		{ depth: 1, parentSessionId: 'ws:ws-a', rootSessionId: 'ws:ws-a' },
	);
	assert.deepEqual(
		establishAgentSessionLineage({
			database,
			parentSessionId: manager,
			sessionId: leaf,
		}),
		{ depth: 2, parentSessionId: manager, rootSessionId: 'ws:ws-a' },
	);
	assert.deepEqual(
		resolveAgentSessionLineage({ database, sessionId: manager }),
		{
			depth: 1,
			parentSessionId: 'ws:ws-a',
			rootSessionId: 'ws:ws-a',
		},
	);
	assert.deepEqual(resolveAgentSessionLineage({ database, sessionId: leaf }), {
		depth: 2,
		parentSessionId: manager,
		rootSessionId: 'ws:ws-a',
	});
	assert.deepEqual(
		listImmediateAgentSessionChildren({
			database,
			parentSessionId: 'ws:ws-a',
		}),
		[manager],
	);
	assert.throws(
		() =>
			establishAgentSessionLineage({
				database,
				parentSessionId: 'missing-native-parent',
				sessionId: untrusted,
			}),
		/Cannot establish agent session lineage/,
	);
});

test('rejects a third delegation edge before it can be persisted', (t) => {
	const database = openFixture(t);
	const root = createSession(database);
	const child = createSession(database);
	const leaf = createSession(database);
	const third = createSession(database);
	establishAgentSessionLineage({ database, sessionId: root });
	establishAgentSessionLineage({
		database,
		parentSessionId: root,
		sessionId: child,
	});
	establishAgentSessionLineage({
		database,
		parentSessionId: child,
		sessionId: leaf,
	});

	assert.throws(
		() =>
			establishAgentSessionLineage({
				database,
				parentSessionId: leaf,
				sessionId: third,
			}),
		/Cannot establish agent session lineage/,
	);
	assert.equal(
		getAgentSessionById({ database, id: third })?.metadata.lineage,
		undefined,
	);
});

test('recovers legacy ancestry through closed parent tabs and persists it', (t) => {
	const database = openFixture(t);
	const root = createSession(database);
	const child = createSession(database);
	const rootTab = openChatTab({
		database,
		input: { kind: 'chat', title: 'Root', workspaceId: 'ws-a' },
	});
	const childTab = openChatTab({
		database,
		input: { kind: 'chat', title: 'Child', workspaceId: 'ws-a' },
	});
	bindAgentSession({ agentSessionId: root, database, id: rootTab.id });
	bindAgentSession({ agentSessionId: child, database, id: childTab.id });
	setChatTabMetadata({
		database,
		id: childTab.id,
		metadata: { agentRole: 'subagent', parentChatTabId: rootTab.id },
	});
	closeChatTab({ database, id: rootTab.id });

	assert.deepEqual(resolveAgentSessionLineage({ database, sessionId: child }), {
		depth: 1,
		parentSessionId: root,
		rootSessionId: root,
	});
	assert.ok(getAgentSessionById({ database, id: root })?.metadata.lineage);
	assert.ok(getAgentSessionById({ database, id: child })?.metadata.lineage);
});

test('recovers a provable legacy parent link even when the role marker is missing or malformed', (t) => {
	for (const role of [undefined, 'malformed']) {
		const database = openFixture(t);
		const root = createSession(database);
		const child = createSession(database);
		const rootTab = openChatTab({
			database,
			input: { kind: 'chat', title: 'Root', workspaceId: 'ws-a' },
		});
		const childTab = openChatTab({
			database,
			input: { kind: 'chat', title: 'Child', workspaceId: 'ws-a' },
		});
		bindAgentSession({ agentSessionId: root, database, id: rootTab.id });
		bindAgentSession({ agentSessionId: child, database, id: childTab.id });
		setChatTabMetadata({
			database,
			id: childTab.id,
			metadata: {
				...(role === undefined ? {} : { agentRole: role }),
				parentChatTabId: rootTab.id,
			},
		});

		assert.deepEqual(
			resolveAgentSessionLineage({ database, sessionId: child }),
			{
				depth: 1,
				parentSessionId: root,
				rootSessionId: root,
			},
		);
	}
});

test('fails closed for missing, malformed, cyclic, wrong-root, and wrong-workspace lineage', (t) => {
	const database = openFixture(t);
	assert.deepEqual(
		resolveAgentSessionLineage({ database, sessionId: 'missing' }),
		{
			depth: 2,
			parentSessionId: null,
			rootSessionId: null,
		},
	);

	const malformed = createSession(database);
	updateAgentSession({
		database,
		id: malformed,
		patch: { metadata: { lineage: { depth: 0 } } },
	});
	assert.equal(
		resolveAgentSessionLineage({ database, sessionId: malformed })
			.rootSessionId,
		null,
	);

	const cycleA = createSession(database);
	const cycleB = createSession(database);
	updateAgentSession({
		database,
		id: cycleA,
		patch: {
			metadata: {
				lineage: {
					depth: 1,
					parentSessionId: cycleB,
					rootSessionId: cycleB,
					version: 1,
				},
			},
		},
	});
	updateAgentSession({
		database,
		id: cycleB,
		patch: {
			metadata: {
				lineage: {
					depth: 1,
					parentSessionId: cycleA,
					rootSessionId: cycleA,
					version: 1,
				},
			},
		},
	});
	assert.equal(
		resolveAgentSessionLineage({ database, sessionId: cycleA }).rootSessionId,
		null,
	);

	const root = createSession(database);
	const wrongRoot = createSession(database);
	establishAgentSessionLineage({ database, sessionId: root });
	updateAgentSession({
		database,
		id: wrongRoot,
		patch: {
			metadata: {
				lineage: {
					depth: 1,
					parentSessionId: root,
					rootSessionId: wrongRoot,
					version: 1,
				},
			},
		},
	});
	assert.equal(
		resolveAgentSessionLineage({ database, sessionId: wrongRoot })
			.rootSessionId,
		null,
	);

	const otherWorkspaceParent = createSession(database, 'ws-b');
	const crossWorkspace = createSession(database);
	establishAgentSessionLineage({ database, sessionId: otherWorkspaceParent });
	updateAgentSession({
		database,
		id: crossWorkspace,
		patch: {
			metadata: {
				lineage: {
					depth: 1,
					parentSessionId: otherWorkspaceParent,
					rootSessionId: otherWorkspaceParent,
					version: 1,
				},
			},
		},
	});
	assert.equal(
		resolveAgentSessionLineage({ database, sessionId: crossWorkspace })
			.rootSessionId,
		null,
	);
});

test('does not promote an unprovable legacy descendant to a root', (t) => {
	const database = openFixture(t);
	for (const role of ['subagent', undefined, 'malformed']) {
		const child = createSession(database);
		const childTab = openChatTab({
			database,
			input: { kind: 'chat', title: 'Child', workspaceId: 'ws-a' },
		});
		bindAgentSession({ agentSessionId: child, database, id: childTab.id });
		setChatTabMetadata({
			database,
			id: childTab.id,
			metadata: {
				...(role === undefined ? {} : { agentRole: role }),
				parentChatTabId: 'gone',
			},
		});

		assert.deepEqual(
			resolveAgentSessionLineage({ database, sessionId: child }),
			{
				depth: 2,
				parentSessionId: null,
				rootSessionId: null,
			},
		);
		assert.equal(
			getAgentSessionById({ database, id: child })?.metadata.lineage,
			undefined,
		);
	}
});
