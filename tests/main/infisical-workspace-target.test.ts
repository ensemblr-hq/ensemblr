import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { expect, onTestFinished, test, vi } from 'vitest';

import { resolveWritableWorkspaceCheckout } from '../../src/main/config/index.ts';
import { createInfisicalAccountStore } from '../../src/main/infisical/infisical-account-store.ts';
import type { InfisicalApiClient } from '../../src/main/infisical/infisical-api.ts';
import { createInfisicalCache } from '../../src/main/infisical/infisical-cache.ts';
import { createInfisicalClient } from '../../src/main/infisical/infisical-client.ts';
import { createInfisicalLinkStore } from '../../src/main/infisical/infisical-link-store.ts';
import {
	createInfisicalService,
	type InfisicalService,
} from '../../src/main/infisical/infisical-service.ts';
import { createMockSecretStore } from '../../src/main/secrets/mock-backend.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import { insertRepositoryRow } from '../../src/main/storage/repositories/repository-row-repository.ts';
import { insertWorkspaceRow } from '../../src/main/storage/repositories/workspace-repository.ts';

const REPOSITORY_ID = 'repo-1';
const WORKSPACE_ID = 'workspace-1';
const SETTINGS_PATH = path.join('.ensemblr', 'settings.toml');
const COMMITTED_BASE = '[scripts]\nsetup = "npm ci"\n';

interface Fixture {
	accountId: string;
	database: DatabaseSync;
	readRoot: () => string;
	readWorkspace: () => string;
	repositoryPath: string;
	service: InfisicalService;
	workspacePath: string;
}

/** Runs one bounded Git command inside a disposable test repository. */
function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** API double answering with one reachable project and one secret. */
function fakeApi(): InfisicalApiClient {
	return {
		listProjects: vi.fn(async () => [
			{
				environments: [{ name: 'Development', slug: 'dev' }],
				id: 'proj_1',
				name: 'Backend',
				slug: 'backend',
			},
		]),
		listSecrets: vi.fn(async () => [
			{ key: 'DATABASE_URL', value: 'postgres://x' },
		]),
		login: vi.fn(async () => ({
			expiresAtMs: Date.now() + 60_000,
			token: 'tok',
		})),
	};
}

/**
 * Builds a repository root, one real linked worktree, and the Infisical service
 * wired to the same target resolver the app uses. Both checkouts start from the
 * one committed settings file, so a write to either is visible as a divergence.
 * @param options - Whether the workspace row is archived.
 * @returns The fixture handles.
 */
async function createFixture({ archived = false } = {}): Promise<Fixture> {
	const parent = mkdtempSync(path.join(tmpdir(), 'ensemblr-infisical-target-'));
	const repositoryPath = path.join(parent, 'root');
	const workspacePath = path.join(parent, 'workspace');
	const timestamp = new Date().toISOString();

	mkdirSync(path.join(repositoryPath, '.ensemblr'), { recursive: true });
	writeFileSync(
		path.join(repositoryPath, SETTINGS_PATH),
		COMMITTED_BASE,
		'utf8',
	);
	git(parent, 'init', '-b', 'main', repositoryPath);
	git(repositoryPath, 'config', 'user.email', 'test@example.com');
	git(repositoryPath, 'config', 'user.name', 'Test');
	git(repositoryPath, 'add', SETTINGS_PATH);
	git(repositoryPath, 'commit', '-m', 'base');
	git(repositoryPath, 'worktree', 'add', '-b', 'feature', workspacePath);

	const connection = openEnsemblrDatabase({
		databasePath: path.join(parent, 'ensemblr.db'),
	});
	const database = connection.database;

	insertRepositoryRow({
		database,
		defaultBranch: 'main',
		id: REPOSITORY_ID,
		metadataJson: '{}',
		name: 'Repo',
		path: repositoryPath,
		remoteUrl: '',
		slug: 'repo',
		timestamp,
	});
	insertWorkspaceRow({
		baseBranch: 'main',
		branchName: 'feature',
		database,
		id: WORKSPACE_ID,
		metadataJson: '{}',
		name: 'Workspace',
		path: workspacePath,
		repositoryId: REPOSITORY_ID,
		slug: 'workspace',
		timestamp,
	});

	if (archived) {
		database
			.prepare('UPDATE workspaces SET archived_at = ? WHERE id = ?')
			.run(timestamp, WORKSPACE_ID);
	}

	const secretStore = createMockSecretStore();
	const accountStore = createInfisicalAccountStore({ database, secretStore });
	const service = createInfisicalService({
		accountStore,
		cache: createInfisicalCache({ secretStore }),
		client: createInfisicalClient({ accountStore, api: fakeApi() }),
		linkStore: createInfisicalLinkStore({ database }),
		resolveWorkspaceCheckout: ({ repositoryId, workspaceId }) =>
			resolveWritableWorkspaceCheckout({ database, repositoryId, workspaceId }),
	});
	const added = await service.addAccount({
		clientId: 'client-1',
		clientSecret: 'secret',
		label: 'Work',
		siteUrl: 'https://app.infisical.com',
	});

	onTestFinished(() => {
		database.close();
		rmSync(parent, { force: true, recursive: true });
	});

	return {
		accountId: added.account?.id ?? '',
		database,
		readRoot: () =>
			readFileSync(path.join(repositoryPath, SETTINGS_PATH), 'utf8'),
		readWorkspace: () =>
			readFileSync(path.join(workspacePath, SETTINGS_PATH), 'utf8'),
		repositoryPath,
		service,
		workspacePath,
	};
}

/** The link request every test saves, against the named workspace. */
function linkRequest(accountId: string, workspaceId: string) {
	return {
		accountId,
		environmentSlug: 'dev',
		projectId: 'proj_1',
		projectName: 'Backend',
		scope: 'repository' as const,
		scopeId: REPOSITORY_ID,
		workspaceId,
	};
}

test('linking writes the committed block onto the named workspace, not the root', async () => {
	const fixture = await createFixture();

	const result = await fixture.service.setLink(
		linkRequest(fixture.accountId, WORKSPACE_ID),
	);

	expect(result.failure).toBeNull();
	expect(fixture.readWorkspace()).toContain('project_id = "proj_1"');
	expect(fixture.readRoot()).toBe(COMMITTED_BASE);
	expect(
		git(fixture.repositoryPath, 'status', '--porcelain', SETTINGS_PATH),
	).toBe('');
});

test('unlinking clears the block on the named workspace and leaves the root untouched', async () => {
	const fixture = await createFixture();
	await fixture.service.setLink(linkRequest(fixture.accountId, WORKSPACE_ID));

	const result = await fixture.service.clearLink({
		scope: 'repository',
		scopeId: REPOSITORY_ID,
		workspaceId: WORKSPACE_ID,
	});

	expect(result.failure).toBeNull();
	expect(fixture.readWorkspace()).not.toContain('project_id');
	expect(fixture.readRoot()).toBe(COMMITTED_BASE);
});

test('reads the committed block back from the workspace it was written to', async () => {
	const fixture = await createFixture();
	await fixture.service.setLink(linkRequest(fixture.accountId, WORKSPACE_ID));
	fixture.database
		.prepare('DELETE FROM infisical_links WHERE scope = ? AND scope_id = ?')
		.run('repository', REPOSITORY_ID);

	const result = fixture.service.getLink({
		scope: 'repository',
		scopeId: REPOSITORY_ID,
		workspaceId: WORKSPACE_ID,
	});

	expect(result.link).toMatchObject({
		environmentSlug: 'dev',
		origin: 'repository-config',
		projectId: 'proj_1',
	});
});

test('refuses an unknown workspace rather than falling back to the root', async () => {
	const fixture = await createFixture();

	const result = await fixture.service.setLink(
		linkRequest(fixture.accountId, 'workspace-missing'),
	);

	expect(result.failure?.code).toBe('infisical-workspace-required');
	expect(fixture.readRoot()).toBe(COMMITTED_BASE);
	expect(existsSync(path.join(fixture.workspacePath, SETTINGS_PATH))).toBe(
		true,
	);
	expect(fixture.readWorkspace()).toBe(COMMITTED_BASE);
});

test('refuses an archived workspace but still saves the local half of the link', async () => {
	const fixture = await createFixture({ archived: true });

	const result = await fixture.service.setLink(
		linkRequest(fixture.accountId, WORKSPACE_ID),
	);

	expect(result.failure?.code).toBe('infisical-workspace-required');
	expect(fixture.readRoot()).toBe(COMMITTED_BASE);
	expect(fixture.readWorkspace()).toBe(COMMITTED_BASE);
	expect(
		fixture.database
			.prepare(
				'SELECT project_id FROM infisical_links WHERE scope = ? AND scope_id = ?',
			)
			.get('repository', REPOSITORY_ID),
	).toMatchObject({ project_id: 'proj_1' });
});

test('refuses a workspace belonging to another repository', async () => {
	const fixture = await createFixture();
	const timestamp = new Date().toISOString();
	insertRepositoryRow({
		database: fixture.database,
		defaultBranch: 'main',
		id: 'repo-2',
		metadataJson: '{}',
		name: 'Other',
		path: path.join(fixture.repositoryPath, '..', 'other'),
		remoteUrl: '',
		slug: 'other',
		timestamp,
	});
	insertWorkspaceRow({
		baseBranch: 'main',
		branchName: 'other',
		database: fixture.database,
		id: 'workspace-other',
		metadataJson: '{}',
		name: 'Other workspace',
		path: path.join(fixture.repositoryPath, '..', 'other-workspace'),
		repositoryId: 'repo-2',
		slug: 'other-workspace',
		timestamp,
	});

	const result = await fixture.service.setLink(
		linkRequest(fixture.accountId, 'workspace-other'),
	);

	expect(result.failure?.code).toBe('infisical-workspace-required');
	expect(fixture.readRoot()).toBe(COMMITTED_BASE);
	expect(fixture.readWorkspace()).toBe(COMMITTED_BASE);
});

test('unlinking with no resolvable workspace is refused rather than silently skipped', async () => {
	const fixture = await createFixture();
	await fixture.service.setLink(linkRequest(fixture.accountId, WORKSPACE_ID));

	const result = await fixture.service.clearLink({
		scope: 'repository',
		scopeId: REPOSITORY_ID,
		workspaceId: 'workspace-missing',
	});

	expect(result.failure?.code).toBe('infisical-clear-workspace-required');
	expect(fixture.readWorkspace()).toContain('project_id = "proj_1"');
	expect(fixture.readRoot()).toBe(COMMITTED_BASE);
});

test('refuses a workspace row whose path is no longer a worktree', async () => {
	const fixture = await createFixture();
	rmSync(fixture.workspacePath, { force: true, recursive: true });
	mkdirSync(fixture.workspacePath, { recursive: true });

	const result = await fixture.service.setLink(
		linkRequest(fixture.accountId, WORKSPACE_ID),
	);

	expect(result.failure?.code).toBe('infisical-workspace-required');
	expect(fixture.readRoot()).toBe(COMMITTED_BASE);
	expect(existsSync(path.join(fixture.workspacePath, SETTINGS_PATH))).toBe(
		false,
	);
});
