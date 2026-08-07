/// <reference types="node" />

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
	type ChatTabService,
	createChatTabService,
} from '../../../src/main/chat-tabs/chat-tab-service.ts';
import {
	type EnsemblrDatabaseConnection,
	type EnsemblrDatabaseService,
	openEnsemblrDatabase,
} from '../../../src/main/storage/database.ts';
import { createAgentSession } from '../../../src/main/storage/repositories/agent-session-repository.ts';

export interface ChatTabServiceFixture {
	agentSessionId: string;
	connection: EnsemblrDatabaseConnection;
	service: ChatTabService;
	workspaceId: string;
}

export const CHAT_TAB_FIXTURE_WORKSPACE_CWD = '/tmp/ensemblr/tab-service/ws';

const WORKSPACE_ID = 'ws-tab-svc';

/**
 * Opens a throwaway SQLite database seeded with one repository, workspace, and
 * Pi session, and returns a chat-tab service bound to it. The database and its
 * temp directory are torn down when the test finishes.
 * @param t - The running test context, used to register cleanup
 * @returns The service under test plus the ids and connection its tests need
 */
export function openChatTabServiceFixture(
	t: import('node:test').TestContext,
): ChatTabServiceFixture {
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
VALUES ('${WORKSPACE_ID}', 'repo-tab-svc', 'tab-svc', 'TabSvc', '${CHAT_TAB_FIXTURE_WORKSPACE_CWD}');
`);

	const { session } = createAgentSession({
		database: connection.database,
		input: {
			cwd: CHAT_TAB_FIXTURE_WORKSPACE_CWD,
			workspaceId: WORKSPACE_ID,
		},
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
			agentSessionExists: ({ agentSessionId }) => agentSessionId === session.id,
		},
	});

	return {
		agentSessionId: session.id,
		connection,
		service,
		workspaceId: WORKSPACE_ID,
	};
}
