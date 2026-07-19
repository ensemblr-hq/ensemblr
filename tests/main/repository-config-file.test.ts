import assert from 'node:assert/strict';
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

import { ensureRepositoryConfigFile } from '../../src/main/config/repository-config-file.ts';

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
