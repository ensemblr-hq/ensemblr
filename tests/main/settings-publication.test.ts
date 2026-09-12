import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { onTestFinished, test } from 'vitest';
import { hasStagedOrConflictedSettings } from '../../src/main/config/settings-publication-files.ts';
import { createSettingsPublicationService } from '../../src/main/config/settings-publication-service.ts';

import {
	readSettingJson,
	upsertSetting,
} from '../../src/main/environment/settings-table.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import { insertRepositoryRow } from '../../src/main/storage/repositories/repository-row-repository.ts';
import { insertWorkspaceRow } from '../../src/main/storage/repositories/workspace-repository.ts';

const REPOSITORY_ID = 'repo-1';
const WORKSPACE_ID = 'workspace-1';
const SETTINGS_PATH = path.join('.ensemblr', 'settings.toml');

/**
 * A settings file shaped like one the app actually writes. The line merge is
 * only clean when the two sides touch separated regions, so a fixture where
 * every key is adjacent proves nothing about independent edits.
 */
const TWO_TABLE_BASE = [
	'#:schema ../schemas/settings.schema.json',
	'',
	'[scripts]',
	'setup = "base"',
	'',
	'[git]',
	'branch_prefix = "base"',
	'',
].join('\n');

interface Fixture {
	database: DatabaseSync;
	repositoryPath: string;
	service: ReturnType<typeof createSettingsPublicationService>;
	workspacePath: string;
	writeRoot: (source: string) => void;
	writeWorkspace: (source: string) => void;
}

/** Runs a bounded Git command inside one disposable test repository. */
function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Reads porcelain status for the settings path without trimming its columns. */
function porcelain(cwd: string): string {
	return execFileSync(
		'git',
		['status', '--porcelain=v1', '--', SETTINGS_PATH],
		{ cwd, encoding: 'utf8' },
	);
}

/** Writes one checkout's settings file, recreating a git-emptied directory. */
function writeSettings(checkoutPath: string, source: string): void {
	mkdirSync(path.join(checkoutPath, '.ensemblr'), { recursive: true });
	writeFileSync(path.join(checkoutPath, SETTINGS_PATH), source, 'utf8');
}

/** Creates a repository root and one real linked worktree tracked in SQLite. */
function createFixture(base = '[scripts]\nsetup = "base"\n'): Fixture {
	const parent = mkdtempSync(path.join(tmpdir(), 'ensemblr-publication-'));
	const repositoryPath = path.join(parent, 'root');
	const workspacePath = path.join(parent, 'workspace');
	const recoveryDirectory = path.join(parent, 'recovery');
	const databasePath = path.join(parent, 'ensemblr.db');
	mkdirSync(path.join(repositoryPath, '.ensemblr'), { recursive: true });
	writeFileSync(path.join(repositoryPath, SETTINGS_PATH), base, 'utf8');
	git(parent, 'init', '-b', 'main', repositoryPath);
	git(repositoryPath, 'config', 'user.email', 'test@example.com');
	git(repositoryPath, 'config', 'user.name', 'Test');
	git(repositoryPath, 'add', SETTINGS_PATH);
	git(repositoryPath, 'commit', '-m', 'base');
	git(repositoryPath, 'worktree', 'add', '-b', 'feature', workspacePath);

	const connection = openEnsemblrDatabase({ databasePath });
	const timestamp = new Date().toISOString();
	insertRepositoryRow({
		database: connection.database,
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
		database: connection.database,
		id: WORKSPACE_ID,
		metadataJson: '{}',
		name: 'Workspace',
		path: workspacePath,
		repositoryId: REPOSITORY_ID,
		slug: 'workspace',
		timestamp,
	});

	onTestFinished(() => {
		connection.database.close();
		rmSync(parent, { force: true, recursive: true });
	});

	return {
		database: connection.database,
		repositoryPath,
		service: createSettingsPublicationService({
			databaseService: { getConnection: () => connection },
			recoveryDirectory,
		}),
		workspacePath,
		writeRoot: (source) => writeSettings(repositoryPath, source),
		writeWorkspace: (source) => writeSettings(workspacePath, source),
	};
}

/** Requests a publication preview for the fixture's known target. */
function preview(fixture: Fixture) {
	return fixture.service.preview({
		repositoryId: REPOSITORY_ID,
		workspaceId: WORKSPACE_ID,
	});
}

test('publishes a clean three-way merge into the workspace only', () => {
	const fixture = createFixture(TWO_TABLE_BASE);
	fixture.writeRoot(TWO_TABLE_BASE.replace('setup = "base"', 'setup = "root"'));
	fixture.writeWorkspace(
		TWO_TABLE_BASE.replace('branch_prefix = "base"', 'branch_prefix = "ws"'),
	);

	const prepared = preview(fixture);
	assert.equal(prepared.preview?.status, 'clean');
	const applied = fixture.service.apply({
		previewToken: prepared.preview?.token ?? '',
		repositoryId: REPOSITORY_ID,
		workspaceId: WORKSPACE_ID,
	});

	assert.equal(applied.status, 'applied');
	assert.match(
		readFileSync(path.join(fixture.workspacePath, SETTINGS_PATH), 'utf8'),
		/setup = "root"[\s\S]*branch_prefix = "ws"/,
	);
	assert.equal(
		readFileSync(path.join(fixture.repositoryPath, SETTINGS_PATH), 'utf8'),
		TWO_TABLE_BASE.replace('setup = "base"', 'setup = "root"'),
	);
	assert.ok(applied.recoveryId);
});

test('returns same-key conflicts without writing either checkout', () => {
	const fixture = createFixture();
	fixture.writeRoot('[scripts]\nsetup = "root"\n');
	fixture.writeWorkspace('[scripts]\nsetup = "workspace"\n');

	const before = readFileSync(
		path.join(fixture.workspacePath, SETTINGS_PATH),
		'utf8',
	);
	const result = preview(fixture);

	assert.equal(result.preview?.status, 'conflict');
	assert.match(result.preview?.mergedText ?? '', /<<<<<<< workspace/);
	assert.equal(
		readFileSync(path.join(fixture.workspacePath, SETTINGS_PATH), 'utf8'),
		before,
	);
});

test('rejects apply after either preview input changes', () => {
	const fixture = createFixture();
	fixture.writeRoot('[scripts]\nsetup = "root"\n');
	const prepared = preview(fixture);
	fixture.writeRoot('[scripts]\nsetup = "changed again"\n');

	const applied = fixture.service.apply({
		previewToken: prepared.preview?.token ?? '',
		repositoryId: REPOSITORY_ID,
		workspaceId: WORKSPACE_ID,
	});

	assert.equal(applied.failure?.code, 'preview-stale');
	assert.equal(applied.status, 'failed');
});

test('cleanup refuses staged root settings and leaves the copied destination', () => {
	const fixture = createFixture();
	fixture.writeRoot('[scripts]\nsetup = "root"\n');
	const prepared = preview(fixture);
	const applied = fixture.service.apply({
		previewToken: prepared.preview?.token ?? '',
		repositoryId: REPOSITORY_ID,
		workspaceId: WORKSPACE_ID,
	});
	git(fixture.repositoryPath, 'add', SETTINGS_PATH);

	const cleaned = fixture.service.cleanup({
		recoveryId: applied.recoveryId ?? '',
	});

	assert.equal(cleaned.failure?.code, 'cleanup-unsafe');
	assert.equal(cleaned.status, 'failed');
	assert.match(
		readFileSync(path.join(fixture.workspacePath, SETTINGS_PATH), 'utf8'),
		/setup = "root"/,
	);
});

test('restores the destination original only while transferred bytes remain', () => {
	const fixture = createFixture();
	fixture.writeRoot('[scripts]\nsetup = "root"\n');
	const prepared = preview(fixture);
	const applied = fixture.service.apply({
		previewToken: prepared.preview?.token ?? '',
		repositoryId: REPOSITORY_ID,
		workspaceId: WORKSPACE_ID,
	});

	const restored = fixture.service.restore({
		copy: 'destination',
		recoveryId: applied.recoveryId ?? '',
	});

	assert.equal(restored.status, 'restored');
	assert.equal(
		readFileSync(path.join(fixture.workspacePath, SETTINGS_PATH), 'utf8'),
		'[scripts]\nsetup = "base"\n',
	);
});

test('rejects a symlinked workspace settings path', () => {
	const fixture = createFixture();
	fixture.writeRoot('[scripts]\nsetup = "root"\n');
	const configPath = path.join(fixture.workspacePath, SETTINGS_PATH);
	rmSync(configPath);
	symlinkSync(path.join(fixture.repositoryPath, SETTINGS_PATH), configPath);

	const result = preview(fixture);

	assert.equal(result.failure?.code, 'path-unsafe');
});

test('publishes and cleans an untracked root settings file', () => {
	const fixture = createFixture('');
	git(fixture.repositoryPath, 'rm', SETTINGS_PATH);
	git(fixture.repositoryPath, 'commit', '-m', 'remove settings');
	rmSync(path.join(fixture.workspacePath, SETTINGS_PATH), { force: true });
	fixture.writeRoot('[scripts]\nsetup = "untracked"\n');

	const prepared = preview(fixture);
	assert.equal(prepared.preview?.sourceStatus, 'untracked');
	const applied = fixture.service.apply({
		previewToken: prepared.preview?.token ?? '',
		repositoryId: REPOSITORY_ID,
		workspaceId: WORKSPACE_ID,
	});
	const cleaned = fixture.service.cleanup({
		recoveryId: applied.recoveryId ?? '',
	});

	assert.equal(cleaned.status, 'cleaned');
	assert.equal(
		existsSync(path.join(fixture.repositoryPath, SETTINGS_PATH)),
		false,
	);
	assert.match(
		readFileSync(path.join(fixture.workspacePath, SETTINGS_PATH), 'utf8'),
		/setup = "untracked"/,
	);
});

test('drains retained script rows once the publication is verified', () => {
	const fixture = createFixture(TWO_TABLE_BASE);
	const scope = { scope: 'repository', scopeId: REPOSITORY_ID } as const;
	upsertSetting({
		database: fixture.database,
		key: 'scripts.setup',
		scope,
		valueJson: JSON.stringify('npm ci'),
	});
	fixture.writeRoot(
		TWO_TABLE_BASE.replace('setup = "base"\n', '').replace('[scripts]\n', ''),
	);

	const prepared = preview(fixture);
	assert.equal(prepared.preview?.hasLegacyScripts, true);
	const applied = fixture.service.apply({
		previewToken: prepared.preview?.token ?? '',
		repositoryId: REPOSITORY_ID,
		workspaceId: WORKSPACE_ID,
	});

	assert.equal(applied.status, 'applied');
	assert.match(
		readFileSync(path.join(fixture.workspacePath, SETTINGS_PATH), 'utf8'),
		/setup = "npm ci"/,
	);
	assert.equal(
		readSettingJson({
			database: fixture.database,
			key: 'scripts.setup',
			scope,
		}),
		null,
	);
});

test('publishes and cleans a tracked, modified, unstaged root settings file', () => {
	const fixture = createFixture();
	fixture.writeRoot('[scripts]\nsetup = "root"\n');
	assert.equal(
		porcelain(fixture.repositoryPath),
		' M .ensemblr/settings.toml\n',
	);

	const prepared = preview(fixture);
	assert.equal(prepared.preview?.sourceStatus, 'modified');
	const applied = fixture.service.apply({
		previewToken: prepared.preview?.token ?? '',
		repositoryId: REPOSITORY_ID,
		workspaceId: WORKSPACE_ID,
	});
	assert.equal(applied.status, 'applied');
	const cleaned = fixture.service.cleanup({
		recoveryId: applied.recoveryId ?? '',
	});

	assert.equal(cleaned.failure, null);
	assert.equal(cleaned.status, 'cleaned');
	assert.equal(
		readFileSync(path.join(fixture.repositoryPath, SETTINGS_PATH), 'utf8'),
		'[scripts]\nsetup = "base"\n',
	);
	assert.equal(porcelain(fixture.repositoryPath), '');
	assert.match(
		readFileSync(path.join(fixture.workspacePath, SETTINGS_PATH), 'utf8'),
		/setup = "root"/,
	);
});

test('reads the index column of a porcelain line rather than its first word', () => {
	assert.equal(hasStagedOrConflictedSettings(''), false);
	assert.equal(
		hasStagedOrConflictedSettings(' M .ensemblr/settings.toml'),
		false,
	);
	assert.equal(
		hasStagedOrConflictedSettings('?? .ensemblr/settings.toml'),
		false,
	);
	assert.equal(
		hasStagedOrConflictedSettings('M  .ensemblr/settings.toml'),
		true,
	);
	assert.equal(
		hasStagedOrConflictedSettings('MM .ensemblr/settings.toml'),
		true,
	);
	assert.equal(
		hasStagedOrConflictedSettings('UU .ensemblr/settings.toml'),
		true,
	);
	assert.equal(
		hasStagedOrConflictedSettings('A  .ensemblr/settings.toml'),
		true,
	);
});
