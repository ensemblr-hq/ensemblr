import assert from 'node:assert/strict';
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
import test, { type TestContext } from 'node:test';

import { ensureRepositoryConfigFile } from '../../src/main/config/repository-config-file.ts';
import { readTomlFile } from '../../src/main/config/repository-config-loaders.ts';

function createRepo(t: TestContext): string {
	const repositoryPath = mkdtempSync(
		path.join(tmpdir(), 'ensemblr-repo-config-'),
	);
	t.after(() => rmSync(repositoryPath, { force: true, recursive: true }));
	return repositoryPath;
}

test('ensureRepositoryConfigFile creates a starter .ensemblr/settings.toml when absent', (t) => {
	const repositoryPath = createRepo(t);

	const filePath = ensureRepositoryConfigFile(repositoryPath);

	assert.equal(
		filePath,
		path.join(repositoryPath, '.ensemblr', 'settings.toml'),
	);
	assert.equal(existsSync(filePath), true);
	assert.match(readFileSync(filePath, 'utf8'), /Ensemblr repository settings/);
});

test('ensureRepositoryConfigFile leaves an existing config file untouched', (t) => {
	const repositoryPath = createRepo(t);
	mkdirSync(path.join(repositoryPath, '.ensemblr'), { recursive: true });
	const filePath = path.join(repositoryPath, '.ensemblr', 'settings.toml');
	writeFileSync(filePath, '[git]\nbranch_from = "develop"\n');

	const returned = ensureRepositoryConfigFile(repositoryPath);

	assert.equal(returned, filePath);
	assert.equal(
		readFileSync(filePath, 'utf8'),
		'[git]\nbranch_from = "develop"\n',
	);
});

test('ensureRepositoryConfigFile refuses a symlinked .ensemblr directory', (t) => {
	const repositoryPath = createRepo(t);
	const victim = createRepo(t);
	symlinkSync(victim, path.join(repositoryPath, '.ensemblr'));

	assert.throws(() => ensureRepositoryConfigFile(repositoryPath), /symlink/);
	assert.equal(existsSync(path.join(victim, 'settings.toml')), false);
});

test('ensureRepositoryConfigFile refuses a symlinked settings file', (t) => {
	const repositoryPath = createRepo(t);
	const victim = path.join(createRepo(t), 'authorized_keys');
	writeFileSync(victim, 'untouched');
	mkdirSync(path.join(repositoryPath, '.ensemblr'), { recursive: true });
	symlinkSync(victim, path.join(repositoryPath, '.ensemblr', 'settings.toml'));

	assert.throws(() => ensureRepositoryConfigFile(repositoryPath), /symlink/);
	assert.equal(readFileSync(victim, 'utf8'), 'untouched');
});

test('readTomlFile refuses a settings file above the configuration limit', (t) => {
	const repositoryPath = createRepo(t);
	mkdirSync(path.join(repositoryPath, '.ensemblr'), { recursive: true });
	const filePath = path.join(repositoryPath, '.ensemblr', 'settings.toml');
	writeFileSync(filePath, `# ${'x'.repeat(1024 * 1024 + 1)}\n`);

	const parsed = readTomlFile({ sourcePath: filePath });

	assert.equal(parsed.status, 'invalid');
	assert.equal(parsed.record, null);
	assert.equal(parsed.diagnostics.at(0)?.code, 'invalid-repository-toml');
	assert.match(parsed.diagnostics.at(0)?.message ?? '', /configuration limit/);
});

test('readTomlFile still parses a settings file within the limit', (t) => {
	const repositoryPath = createRepo(t);
	mkdirSync(path.join(repositoryPath, '.ensemblr'), { recursive: true });
	const filePath = path.join(repositoryPath, '.ensemblr', 'settings.toml');
	writeFileSync(filePath, '[scripts]\nsetup = "npm install"\n');

	const parsed = readTomlFile({ sourcePath: filePath });

	assert.equal(parsed.status, 'loaded');
	assert.deepEqual(structuredClone(parsed.record), {
		scripts: { setup: 'npm install' },
	});
});
