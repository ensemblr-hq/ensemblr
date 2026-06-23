import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { createLocalCommandService } from '../../src/main/commands/local-command.ts';
import { createWorkspaceService } from '../../src/main/repository/create-workspace.ts';
import {
	type EnsembleDatabaseConnection,
	type EnsembleDatabaseService,
	openEnsembleDatabase,
} from '../../src/main/storage/database.ts';
import type { WorkspaceLinkedIssueInput } from '../../src/shared/ipc/index.ts';
import { buildRootDirectoryStub } from './helpers/root-directory-stub.ts';

const fixedNow = () => new Date('2026-06-11T12:00:00.000Z');

const LINKED_ISSUE: WorkspaceLinkedIssueInput = {
	id: 'issue-1',
	identifier: 'THE-143',
	provider: 'linear',
	teamKey: 'THE',
	teamName: 'Theseus',
	title: 'Linear OAuth PKCE and Token Lifecycle',
	url: 'https://linear.app/acme/issue/THE-143',
};

function createHarness(t: TestContext) {
	const rootPath = mkdtempSync(path.join(tmpdir(), 'ensemble-linked-issue-'));
	const repositoriesPath = path.join(rootPath, 'repos');
	const workspacesPath = path.join(rootPath, 'workspaces');
	mkdirSync(repositoriesPath, { recursive: true });
	mkdirSync(workspacesPath, { recursive: true });

	const repositoryPath = path.join(repositoriesPath, 'demo');
	mkdirSync(repositoryPath);
	runGit(repositoryPath, ['init', '-b', 'main']);
	runGit(repositoryPath, ['config', 'user.email', 'test@ensemble.dev']);
	runGit(repositoryPath, ['config', 'user.name', 'Ensemble Test']);
	writeFileSync(path.join(repositoryPath, 'README.md'), '# demo\n');
	runGit(repositoryPath, ['add', '.']);
	runGit(repositoryPath, ['commit', '-m', 'init']);

	const connection = openEnsembleDatabase({ databasePath: ':memory:' });
	const timestamp = fixedNow().toISOString();
	connection.database
		.prepare(
			`INSERT INTO repositories (id, slug, name, path, default_branch, created_at, updated_at, metadata_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			'repository-demo',
			'demo',
			'demo',
			repositoryPath,
			'main',
			timestamp,
			timestamp,
			'{}',
		);

	const databaseService = wrapConnection(connection);

	t.after(() => {
		connection.database.close();
		rmSync(rootPath, { force: true, recursive: true });
	});

	return {
		databaseService,
		repositoryId: 'repository-demo',
		rootPath,
		workspacesPath,
	};
}

function wrapConnection(
	connection: EnsembleDatabaseConnection,
): EnsembleDatabaseService {
	return {
		close: () => connection.database.close(),
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
}

function runGit(cwd: string, args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('create with linkedIssue persists issue metadata and the integration link row', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: buildRootDirectoryStub({
			rootPath: harness.rootPath,
			workspacesPath: harness.workspacesPath,
		}),
	});

	const result = await service.create({
		branchName: 'feat/the-143-linear-oauth-pkce-and-token-life',
		linkedIssue: LINKED_ISSUE,
		name: 'THE-143 Linear OAuth PKCE and Token Lifecycle',
		repositoryId: harness.repositoryId,
	});

	assert.strictEqual(result.status, 'success');
	assert.ok(result.workspace);
	assert.strictEqual(
		result.workspace.branchName,
		'feat/the-143-linear-oauth-pkce-and-token-life',
	);
	assert.deepStrictEqual(result.workspace.metadata.linkedIssue, LINKED_ISSUE);

	const database = harness.databaseService.getConnection()?.database;
	assert.ok(database);

	const workspaceRow = database
		.prepare('SELECT metadata_json FROM workspaces WHERE id = ?')
		.get(result.workspace.id) as { metadata_json: string };
	const persistedMetadata = JSON.parse(workspaceRow.metadata_json) as Record<
		string,
		unknown
	>;
	assert.deepStrictEqual(persistedMetadata.linkedIssue, LINKED_ISSUE);

	const linkRow = database
		.prepare(
			`SELECT provider, resource_type, resource_id, external_id, metadata_json
			 FROM integration_metadata WHERE resource_type = 'workspace-link'`,
		)
		.get() as {
		external_id: string;
		metadata_json: string;
		provider: string;
		resource_id: string;
		resource_type: string;
	};
	assert.strictEqual(linkRow.provider, 'linear');
	assert.strictEqual(linkRow.resource_id, result.workspace.id);
	assert.strictEqual(linkRow.external_id, 'issue-1');
	assert.deepStrictEqual(JSON.parse(linkRow.metadata_json), LINKED_ISSUE);
});

test('create without linkedIssue writes no integration link row', async (t) => {
	const harness = createHarness(t);
	const service = createWorkspaceService({
		databaseService: harness.databaseService,
		localCommandService: createLocalCommandService(),
		now: fixedNow,
		rootDirectoryService: buildRootDirectoryStub({
			rootPath: harness.rootPath,
			workspacesPath: harness.workspacesPath,
		}),
	});

	const result = await service.create({
		name: 'plain workspace',
		repositoryId: harness.repositoryId,
	});

	assert.strictEqual(result.status, 'success');
	assert.ok(result.workspace);
	assert.strictEqual(result.workspace.metadata.linkedIssue, undefined);

	const database = harness.databaseService.getConnection()?.database;
	assert.ok(database);
	const rows = database
		.prepare(
			`SELECT id FROM integration_metadata WHERE resource_type = 'workspace-link'`,
		)
		.all();
	assert.strictEqual(rows.length, 0);
});
