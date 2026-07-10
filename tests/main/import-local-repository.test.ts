import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { createLocalCommandService } from '../../src/main/commands/local-command.ts';
import { createLocalRepositoryImportService } from '../../src/main/repository/import-local-repository.ts';
import type { LocalRepositoryRegistrationService } from '../../src/main/repository/register-repository.ts';
import type { EnsemblrRootDirectoryService } from '../../src/main/root';
import type { RegisteredRepositorySnapshot } from '../../src/shared/ipc/contracts/repository.ts';
import type { RootDirectorySnapshot } from '../../src/shared/ipc/contracts/root-directory.ts';

function createFixtureDirectory(t: TestContext, prefix: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), prefix));

	t.after(() => {
		rmSync(directory, { force: true, recursive: true });
	});

	return directory;
}

function createRootSnapshot(rootPath: string): RootDirectorySnapshot {
	return {
		archivedContextsPath: path.join(rootPath, 'archived-contexts'),
		createdPaths: [],
		diagnostics: [],
		managedPaths: [],
		path: rootPath,
		repositoriesPath: path.join(rootPath, 'repos'),
		setting: null,
		source: null,
		status: 'ok',
		workspacesPath: path.join(rootPath, 'workspaces'),
	};
}

function rootDirectoryStub(
	snapshot: RootDirectorySnapshot,
): EnsemblrRootDirectoryService {
	return {
		applyChange: () => ({
			applied: false,
			newRoot: null,
			oldRoot: snapshot,
			oldRootPreserved: true,
			reconciliation: null,
		}),
		ensure: () => snapshot,
		getSnapshot: () => snapshot,
		previewChange: () => ({
			canApply: true,
			diagnostics: [],
			newRoot: snapshot,
			oldRoot: snapshot,
			oldRootPreserved: true,
		}),
	};
}

function runGit(cwd: string, args: string[]): string {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
}

function createGitRepository(cwd: string): void {
	runGit(cwd, ['init', '-b', 'main']);
	runGit(cwd, ['config', 'user.email', 'test@ensemblr.dev']);
	runGit(cwd, ['config', 'user.name', 'Ensemblr Test']);
}

function createRepositorySnapshot({
	name,
	targetPath,
}: {
	name: string;
	targetPath: string;
}): RegisteredRepositorySnapshot {
	return {
		createdAt: '2026-06-15T00:00:00.000Z',
		defaultBranch: 'main',
		id: 'repository-imported',
		metadata: {},
		name,
		path: targetPath,
		remoteUrl: null,
		slug: name,
		updatedAt: '2026-06-15T00:00:00.000Z',
	};
}

test('importLocalRepository copies the selected project into managed repos before registering it', async (t) => {
	const sourcePath = createFixtureDirectory(t, 'ensemblr-import-source-');
	const rootPath = createFixtureDirectory(t, 'ensemblr-import-root-');
	const nestedPath = path.join(sourcePath, 'src');
	const untrackedPath = path.join(sourcePath, 'node_modules');
	mkdirSync(nestedPath);
	mkdirSync(untrackedPath);
	createGitRepository(sourcePath);
	writeFileSync(path.join(sourcePath, 'README.md'), '# imported\n');
	writeFileSync(path.join(nestedPath, 'index.ts'), 'export const value = 1;\n');
	writeFileSync(path.join(untrackedPath, 'cache.txt'), 'skip me\n');
	runGit(sourcePath, ['add', 'README.md', 'src/index.ts']);
	runGit(sourcePath, ['commit', '-m', 'init']);

	let registeredPath: string | null = null;
	const registrationService: LocalRepositoryRegistrationService = {
		register: async (request) => {
			registeredPath = request.path;
			return {
				diagnostics: [],
				registered: true,
				repository: createRepositorySnapshot({
					name: request.name ?? path.basename(request.path),
					targetPath: request.path,
				}),
				settingsSources: [],
			};
		},
	};
	const service = createLocalRepositoryImportService({
		localCommandService: createLocalCommandService(),
		registrationService,
		rootDirectoryService: rootDirectoryStub(createRootSnapshot(rootPath)),
	});

	const result = await service.importRepository({ path: sourcePath });

	assert.equal(result.registered, true);
	assert.ok(registeredPath);
	assert.notEqual(registeredPath, sourcePath);
	assert.equal(path.dirname(registeredPath), path.join(rootPath, 'repos'));
	assert.equal(existsSync(path.join(registeredPath, 'README.md')), true);
	assert.equal(existsSync(path.join(registeredPath, 'src', 'index.ts')), true);
	assert.equal(existsSync(path.join(registeredPath, '.git', 'HEAD')), true);
	assert.equal(existsSync(path.join(registeredPath, 'node_modules')), false);
	assert.equal(result.repository?.path, registeredPath);
});

test('importLocalRepository rolls back the managed copy when registration fails', async (t) => {
	const sourcePath = createFixtureDirectory(t, 'ensemblr-import-source-');
	const rootPath = createFixtureDirectory(t, 'ensemblr-import-root-');
	createGitRepository(sourcePath);
	writeFileSync(path.join(sourcePath, 'README.md'), '# rollback\n');
	runGit(sourcePath, ['add', 'README.md']);
	runGit(sourcePath, ['commit', '-m', 'init']);

	let targetPath: string | null = null;
	const registrationService: LocalRepositoryRegistrationService = {
		register: async (request) => {
			targetPath = request.path;
			return {
				diagnostics: [
					{
						code: 'path-not-a-git-repository',
						message: 'not a git repository',
						severity: 'error',
					},
				],
				registered: false,
				repository: null,
				settingsSources: [],
			};
		},
	};
	const service = createLocalRepositoryImportService({
		localCommandService: createLocalCommandService(),
		registrationService,
		rootDirectoryService: rootDirectoryStub(createRootSnapshot(rootPath)),
	});

	const result = await service.importRepository({ path: sourcePath });

	assert.equal(result.registered, false);
	assert.equal(result.diagnostics[0]?.code, 'path-not-a-git-repository');
	assert.ok(targetPath);
	assert.equal(existsSync(targetPath), false);
});

test('importLocalRepository rejects destinations inside the selected source', async (t) => {
	const sourcePath = createFixtureDirectory(t, 'ensemblr-import-source-');
	const rootPath = path.join(sourcePath, 'Ensemblr');
	createGitRepository(sourcePath);
	writeFileSync(path.join(sourcePath, 'README.md'), '# nested\n');
	runGit(sourcePath, ['add', 'README.md']);
	runGit(sourcePath, ['commit', '-m', 'init']);
	const registrationService: LocalRepositoryRegistrationService = {
		register: async () => {
			throw new Error('registration should not run');
		},
	};
	const service = createLocalRepositoryImportService({
		localCommandService: createLocalCommandService(),
		registrationService,
		rootDirectoryService: rootDirectoryStub(createRootSnapshot(rootPath)),
	});

	const result = await service.importRepository({ path: sourcePath });

	assert.equal(result.registered, false);
	assert.equal(
		result.diagnostics[0]?.code,
		'repository-copy-target-inside-source',
	);
});

test('importLocalRepository rejects sources that are not git repositories', async (t) => {
	const sourcePath = createFixtureDirectory(t, 'ensemblr-import-source-');
	const rootPath = createFixtureDirectory(t, 'ensemblr-import-root-');
	writeFileSync(path.join(sourcePath, 'README.md'), '# no git here\n');
	const registrationService: LocalRepositoryRegistrationService = {
		register: async () => {
			throw new Error('registration should not run');
		},
	};
	const service = createLocalRepositoryImportService({
		localCommandService: createLocalCommandService(),
		registrationService,
		rootDirectoryService: rootDirectoryStub(createRootSnapshot(rootPath)),
	});

	const result = await service.importRepository({ path: sourcePath });

	assert.equal(result.registered, false);
	assert.equal(result.diagnostics[0]?.code, 'path-not-a-git-repository');
});
