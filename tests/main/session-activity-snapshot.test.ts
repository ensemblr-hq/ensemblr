import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { snapshotToWire } from '../../src/main/agent-runtime/agent-session-service.ts';
import { projectSessionActivity } from '../../src/main/agent-runtime/session/session-activity-snapshot.ts';
import { toSnapshot } from '../../src/main/agent-runtime/session/session-snapshot.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import { appendAgentEvents } from '../../src/main/storage/repositories/agent-event-repository.ts';
import { createAgentSession } from '../../src/main/storage/repositories/agent-session-repository.ts';

interface Fixture {
	branchId: string;
	database: DatabaseSync;
	snapshot: ReturnType<typeof toSnapshot>;
}

function openFixture(t: import('node:test').TestContext): Fixture {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-activity-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'activity.db'),
	});
	t.after(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});
	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo', 'repo', 'Repo', '/tmp/repo', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('workspace', 'repo', 'workspace', 'Workspace', '/tmp/repo/workspace');
`);
	const { mainBranch, session } = createAgentSession({
		database: connection.database,
		input: { cwd: '/tmp/repo/workspace', workspaceId: 'workspace' },
	});
	return {
		branchId: mainBranch.id,
		database: connection.database,
		snapshot: toSnapshot({
			branchId: mainBranch.id,
			database: connection.database,
			openedTabs: [],
			row: session,
			runtimeOpen: true,
		}),
	};
}

test('recoverable diagnostics do not hide newer in-flight tool activity', (t) => {
	const fixture = openFixture(t);
	appendAgentEvents({
		branchId: fixture.branchId,
		database: fixture.database,
		events: [
			{
				eventType: 'message',
				payload: {
					kind: 'message',
					payload: {
						input: { path: 'README.md' },
						kind: 'tool-call',
						name: 'read',
						toolCallId: 'call-1',
					},
					role: 'agent',
				},
			},
			{
				eventType: 'error',
				payload: {
					error: { message: 'Pi RPC stderr', recoverable: true },
					kind: 'error',
				},
				stream: 'stderr',
			},
			{
				eventType: 'message',
				payload: {
					kind: 'message',
					payload: {
						input: { path: 'src/index.ts' },
						kind: 'tool-update',
						name: 'read',
						presentation: { title: 'Reading', version: 1 },
						toolCallId: 'call-1',
					},
					role: 'tool',
				},
			},
		],
	});

	const projected = projectSessionActivity({
		active: { contextUsage: null },
		database: fixture.database,
		snapshot: fixture.snapshot,
	});

	assert.ok('activityOrdinal' in projected);
	assert.equal(projected.activityOrdinal, 2);
	assert.equal(snapshotToWire(projected).activityOrdinal, 2);
	assert.deepEqual(projected.currentTools, [
		{
			input: { path: 'src/index.ts' },
			name: 'read',
			presentation: { title: 'Reading', version: 1 },
			toolCallId: 'call-1',
		},
	]);
});
