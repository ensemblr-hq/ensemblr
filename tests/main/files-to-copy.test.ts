import assert from 'node:assert/strict';
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
import test, { type TestContext } from 'node:test';

import { createLocalCommandService } from '../../src/main/commands/local-command.ts';
import { loadRepositoryConfig } from '../../src/main/config/repository-config.ts';
import { createFilesToCopyService } from '../../src/main/repository/files-to-copy.ts';

interface FilesToCopyFixture {
	repositoryPath: string;
	workspacePath: string;
}

const fixedNow = () => new Date('2026-06-08T12:00:00.000Z');

function runGit(cwd: string, args: string[]): void {
	execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function createFixture(t: TestContext): FilesToCopyFixture {
	const root = mkdtempSync(path.join(tmpdir(), 'ensemble-files-to-copy-'));
	const repositoryPath = path.join(root, 'repo');
	const workspacePath = path.join(root, 'workspace');
	mkdirSync(repositoryPath, { recursive: true });
	mkdirSync(workspacePath, { recursive: true });

	runGit(repositoryPath, ['init', '-b', 'main']);
	runGit(repositoryPath, ['config', 'user.email', 'test@ensemble.dev']);
	runGit(repositoryPath, ['config', 'user.name', 'Ensemble Test']);

	writeFileSync(path.join(repositoryPath, '.gitignore'), '*.env\n.env*\n');
	writeFileSync(path.join(repositoryPath, 'README.md'), '# demo\n');
	runGit(repositoryPath, ['add', '.']);
	runGit(repositoryPath, ['commit', '-m', 'init']);

	t.after(() => {
		rmSync(root, { force: true, recursive: true });
	});

	return { repositoryPath, workspacePath };
}

test('default `.env*` pattern copies gitignored env files', async (t) => {
	const fixture = createFixture(t);
	writeFileSync(path.join(fixture.repositoryPath, '.env'), 'API_KEY=secret\n');
	writeFileSync(path.join(fixture.repositoryPath, '.env.local'), 'OTHER=1\n');

	const service = createFilesToCopyService({
		localCommandService: createLocalCommandService(),
	});

	const result = await service.copy({
		config: loadRepositoryConfig({
			now: fixedNow,
			repositoryPath: fixture.repositoryPath,
		}),
		repositoryPath: fixture.repositoryPath,
		workspacePath: fixture.workspacePath,
	});

	assert.equal(result.source, 'default');
	assert.deepEqual(result.patterns, ['.env*']);
	assert.equal(result.copied.length, 2);
	assert.equal(result.diagnostics.length, 0);
	assert.equal(
		readFileSync(path.join(fixture.workspacePath, '.env'), 'utf8'),
		'API_KEY=secret\n',
	);
	assert.equal(
		readFileSync(path.join(fixture.workspacePath, '.env.local'), 'utf8'),
		'OTHER=1\n',
	);
});

test('tracked files matching patterns are not copied', async (t) => {
	const fixture = createFixture(t);
	writeFileSync(
		path.join(fixture.repositoryPath, 'tracked.env'),
		'TRACKED=1\n',
	);
	runGit(fixture.repositoryPath, ['add', '-f', 'tracked.env']);
	runGit(fixture.repositoryPath, ['commit', '-m', 'add tracked env']);
	writeFileSync(path.join(fixture.repositoryPath, '.env'), 'UNTRACKED=1\n');

	const service = createFilesToCopyService({
		localCommandService: createLocalCommandService(),
	});

	const result = await service.copy({
		config: loadRepositoryConfig({
			now: fixedNow,
			repositoryPath: fixture.repositoryPath,
		}),
		repositoryPath: fixture.repositoryPath,
		workspacePath: fixture.workspacePath,
	});

	assert.equal(result.copied.length, 1);
	assert.equal(result.copied[0]?.relativePath, '.env');
	assert.equal(
		existsSync(path.join(fixture.workspacePath, 'tracked.env')),
		false,
	);
});

test('`.worktreeinclude` wins over ensemble.json files-to-copy', async (t) => {
	const fixture = createFixture(t);
	writeFileSync(
		path.join(fixture.repositoryPath, '.gitignore'),
		'config.local\n.env*\nsecret.json\n',
	);
	writeFileSync(path.join(fixture.repositoryPath, '.env'), 'X=1\n');
	writeFileSync(path.join(fixture.repositoryPath, 'config.local'), 'C=1\n');
	writeFileSync(path.join(fixture.repositoryPath, 'secret.json'), '{}\n');
	writeFileSync(
		path.join(fixture.repositoryPath, '.worktreeinclude'),
		'# Conductor compatible\nconfig.local\n',
	);
	writeFileSync(
		path.join(fixture.repositoryPath, 'ensemble.json'),
		JSON.stringify({ filesToCopy: ['secret.json'] }),
	);

	const service = createFilesToCopyService({
		localCommandService: createLocalCommandService(),
	});

	const result = await service.copy({
		config: loadRepositoryConfig({
			now: fixedNow,
			repositoryPath: fixture.repositoryPath,
		}),
		repositoryPath: fixture.repositoryPath,
		workspacePath: fixture.workspacePath,
	});

	assert.equal(result.source, 'worktreeinclude');
	assert.deepEqual(result.patterns, ['config.local']);
	assert.equal(result.copied.length, 1);
	assert.equal(result.copied[0]?.relativePath, 'config.local');
	assert.equal(existsSync(path.join(fixture.workspacePath, '.env')), false);
	assert.equal(
		existsSync(path.join(fixture.workspacePath, 'secret.json')),
		false,
	);
});

test('ensemble.json files-to-copy is used when no .worktreeinclude or conductor config', async (t) => {
	const fixture = createFixture(t);
	writeFileSync(
		path.join(fixture.repositoryPath, '.gitignore'),
		'.env*\nsecrets/\n',
	);
	mkdirSync(path.join(fixture.repositoryPath, 'secrets'), { recursive: true });
	writeFileSync(
		path.join(fixture.repositoryPath, 'secrets', 'api.key'),
		'KEY=1\n',
	);
	writeFileSync(path.join(fixture.repositoryPath, '.env'), 'IGNORED=1\n');
	writeFileSync(
		path.join(fixture.repositoryPath, 'ensemble.json'),
		JSON.stringify({ filesToCopy: ['secrets/**'] }),
	);

	const service = createFilesToCopyService({
		localCommandService: createLocalCommandService(),
	});

	const result = await service.copy({
		config: loadRepositoryConfig({
			now: fixedNow,
			repositoryPath: fixture.repositoryPath,
		}),
		repositoryPath: fixture.repositoryPath,
		workspacePath: fixture.workspacePath,
	});

	assert.equal(result.source, 'ensemble-config');
	assert.deepEqual(result.patterns, ['secrets/**']);
	assert.equal(result.copied.length, 1);
	assert.equal(result.copied[0]?.relativePath, 'secrets/api.key');
	assert.equal(
		readFileSync(
			path.join(fixture.workspacePath, 'secrets', 'api.key'),
			'utf8',
		),
		'KEY=1\n',
	);
	assert.equal(
		existsSync(path.join(fixture.workspacePath, '.env')),
		false,
		'default .env* should not apply when ensemble.json declared filesToCopy',
	);
});

test('nested gitignore-style patterns target subdirectory files', async (t) => {
	const fixture = createFixture(t);
	writeFileSync(
		path.join(fixture.repositoryPath, '.gitignore'),
		'**/local.toml\n',
	);
	mkdirSync(path.join(fixture.repositoryPath, 'apps', 'web'), {
		recursive: true,
	});
	writeFileSync(
		path.join(fixture.repositoryPath, 'apps', 'web', 'local.toml'),
		'name = "web"\n',
	);
	writeFileSync(
		path.join(fixture.repositoryPath, '.worktreeinclude'),
		'apps/**/local.toml\n',
	);

	const service = createFilesToCopyService({
		localCommandService: createLocalCommandService(),
	});

	const result = await service.copy({
		config: loadRepositoryConfig({
			now: fixedNow,
			repositoryPath: fixture.repositoryPath,
		}),
		repositoryPath: fixture.repositoryPath,
		workspacePath: fixture.workspacePath,
	});

	assert.equal(result.source, 'worktreeinclude');
	assert.equal(result.copied.length, 1);
	assert.equal(result.copied[0]?.relativePath, 'apps/web/local.toml');
	assert.equal(
		readFileSync(
			path.join(fixture.workspacePath, 'apps', 'web', 'local.toml'),
			'utf8',
		),
		'name = "web"\n',
	);
});

test('empty `.worktreeinclude` skips the default fallback', async (t) => {
	const fixture = createFixture(t);
	writeFileSync(path.join(fixture.repositoryPath, '.env'), 'X=1\n');
	writeFileSync(
		path.join(fixture.repositoryPath, '.worktreeinclude'),
		'# only comments\n\n',
	);

	const service = createFilesToCopyService({
		localCommandService: createLocalCommandService(),
	});

	const result = await service.copy({
		config: loadRepositoryConfig({
			now: fixedNow,
			repositoryPath: fixture.repositoryPath,
		}),
		repositoryPath: fixture.repositoryPath,
		workspacePath: fixture.workspacePath,
	});

	assert.equal(result.source, 'worktreeinclude');
	assert.deepEqual(result.patterns, []);
	assert.equal(result.copied.length, 0);
	assert.equal(existsSync(path.join(fixture.workspacePath, '.env')), false);
});

test('non-existent matches do not crash the copy', async (t) => {
	const fixture = createFixture(t);
	writeFileSync(
		path.join(fixture.repositoryPath, '.worktreeinclude'),
		'ghost.env\n',
	);

	const service = createFilesToCopyService({
		localCommandService: createLocalCommandService(),
	});

	const result = await service.copy({
		config: loadRepositoryConfig({
			now: fixedNow,
			repositoryPath: fixture.repositoryPath,
		}),
		repositoryPath: fixture.repositoryPath,
		workspacePath: fixture.workspacePath,
	});

	assert.equal(result.source, 'worktreeinclude');
	assert.equal(result.copied.length, 0);
	assert.equal(result.diagnostics.length, 0);
});

test('invalid filesToCopy (non-string-array) falls through to next source', async (t) => {
	const fixture = createFixture(t);
	writeFileSync(path.join(fixture.repositoryPath, '.gitignore'), '.env*\n');
	writeFileSync(path.join(fixture.repositoryPath, '.env'), 'X=1\n');
	writeFileSync(
		path.join(fixture.repositoryPath, 'ensemble.json'),
		JSON.stringify({ filesToCopy: 'not-an-array' }),
	);

	const service = createFilesToCopyService({
		localCommandService: createLocalCommandService(),
	});

	const result = await service.copy({
		config: loadRepositoryConfig({
			now: fixedNow,
			repositoryPath: fixture.repositoryPath,
		}),
		repositoryPath: fixture.repositoryPath,
		workspacePath: fixture.workspacePath,
	});

	assert.equal(result.source, 'default');
	assert.equal(result.copied.length, 1);
	assert.equal(result.copied[0]?.relativePath, '.env');
});
