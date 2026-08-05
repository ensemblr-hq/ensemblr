import assert from 'node:assert/strict';
import {
	chmodSync,
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

import { load } from 'js-toml';

import { writeRepositoryScripts } from '../../src/main/config/repository-scripts-writer.ts';
import type { RunScriptDefinition } from '../../src/shared/scripts.ts';

function createRepositoryFixture(t: TestContext): {
	configPath: string;
	read: () => string;
	readRecord: () => Record<string, unknown>;
	repositoryPath: string;
	write: (source: string) => void;
} {
	const repositoryPath = mkdtempSync(path.join(tmpdir(), 'ensemblr-scripts-'));
	const configPath = path.join(repositoryPath, '.ensemblr', 'settings.toml');

	t.after(() => {
		rmSync(repositoryPath, { force: true, recursive: true });
	});

	return {
		configPath,
		read: () => readFileSync(configPath, 'utf8'),
		// js-toml returns null-prototype tables, which deepStrictEqual rejects
		// against object literals; structuredClone re-parents them.
		readRecord: () =>
			structuredClone(load(readFileSync(configPath, 'utf8'))) as Record<
				string,
				unknown
			>,
		repositoryPath,
		write: (source) => {
			mkdirSync(path.dirname(configPath), { recursive: true });
			writeFileSync(configPath, source, 'utf8');
		},
	};
}

function runScript(
	overrides: Partial<RunScriptDefinition> = {},
): RunScriptDefinition {
	return {
		availableIn: null,
		command: 'npm run dev',
		icon: 'play',
		isDefault: false,
		name: 'dev',
		...overrides,
	};
}

function writeInput(
	repositoryPath: string,
	overrides: Partial<Parameters<typeof writeRepositoryScripts>[0]> = {},
): Parameters<typeof writeRepositoryScripts>[0] {
	return {
		archive: null,
		autoRunAfterSetup: false,
		repositoryPath,
		runScriptMode: 'concurrent',
		runScripts: [],
		setup: null,
		...overrides,
	};
}

test('creates .ensemblr/settings.toml with the full scripts block', (t) => {
	const fixture = createRepositoryFixture(t);

	const result = writeRepositoryScripts(
		writeInput(fixture.repositoryPath, {
			archive: 'rm -rf node_modules',
			autoRunAfterSetup: true,
			runScriptMode: 'nonconcurrent',
			runScripts: [
				runScript({
					availableIn: ['local'],
					command: 'PORT=$ENSEMBLR_PORT npm run dev',
					icon: 'server',
					isDefault: true,
				}),
				runScript({ command: 'npm test', icon: 'test-tube', name: 'test' }),
			],
			setup: 'npm ci',
		}),
	);

	assert.equal(result.ok, true);
	assert.deepEqual(fixture.readRecord(), {
		scripts: {
			archive: 'rm -rf node_modules',
			auto_run_after_setup: true,
			run: {
				dev: {
					available_in: ['local'],
					command: 'PORT=$ENSEMBLR_PORT npm run dev',
					default: true,
					icon: 'server',
				},
				test: { command: 'npm test', icon: 'test-tube' },
			},
			run_mode: 'nonconcurrent',
			setup: 'npm ci',
		},
	});
});

test('emits named run scripts as [scripts.run.<name>] tables', (t) => {
	const fixture = createRepositoryFixture(t);

	writeRepositoryScripts(
		writeInput(fixture.repositoryPath, {
			runScripts: [runScript({ name: 'dev' })],
			setup: 'npm ci',
		}),
	);

	const source = fixture.read();

	assert.match(source, /^\[scripts\]$/m);
	assert.match(source, /^\[scripts\.run\.dev\]$/m);
	assert.doesNotMatch(source, /\{/);
});

test('omits icon, default, and available_in at their defaults', (t) => {
	const fixture = createRepositoryFixture(t);

	writeRepositoryScripts(
		writeInput(fixture.repositoryPath, {
			runScripts: [runScript()],
		}),
	);

	const scripts = (fixture.readRecord().scripts as Record<string, unknown>)
		.run as Record<string, Record<string, unknown>>;

	assert.deepEqual(scripts.dev, { command: 'npm run dev' });
});

test('removes setup and archive keys when the command is blank', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write('[scripts]\nsetup = "npm ci"\narchive = "rm -rf dist"\n');

	writeRepositoryScripts(
		writeInput(fixture.repositoryPath, { archive: '   ', setup: '' }),
	);

	assert.deepEqual(fixture.readRecord(), {
		scripts: { auto_run_after_setup: false, run_mode: 'concurrent' },
	});
});

test('trims setup and archive commands before writing', (t) => {
	const fixture = createRepositoryFixture(t);

	writeRepositoryScripts(
		writeInput(fixture.repositoryPath, {
			archive: '  rm -rf dist  ',
			setup: '  npm ci  ',
		}),
	);

	const scripts = fixture.readRecord().scripts as Record<string, unknown>;

	assert.equal(scripts.setup, 'npm ci');
	assert.equal(scripts.archive, 'rm -rf dist');
});

test('omits run_mode and auto_run_after_setup when they are null', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write(
		'[scripts]\nrun_mode = "nonconcurrent"\nauto_run_after_setup = true\n',
	);

	writeRepositoryScripts(
		writeInput(fixture.repositoryPath, {
			autoRunAfterSetup: null,
			runScriptMode: null,
			setup: 'npm ci',
		}),
	);

	assert.deepEqual(fixture.readRecord(), { scripts: { setup: 'npm ci' } });
});

test('replaces a legacy scripts.run string with named tables', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write('[scripts]\nsetup = "npm ci"\nrun = "npm run dev"\n');

	writeRepositoryScripts(
		writeInput(fixture.repositoryPath, {
			runScripts: [runScript({ command: 'npm start', name: 'start' })],
			setup: 'npm ci',
		}),
	);

	const scripts = fixture.readRecord().scripts as Record<string, unknown>;

	assert.deepEqual(scripts.run, { start: { command: 'npm start' } });
});

test('drops the run table entirely when no run scripts remain', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write('[scripts.run.dev]\ncommand = "npm run dev"\n');

	writeRepositoryScripts(writeInput(fixture.repositoryPath));

	const scripts = fixture.readRecord().scripts as Record<string, unknown>;

	assert.equal('run' in scripts, false);
});

test('preserves other sections and unknown script keys', (t) => {
	const fixture = createRepositoryFixture(t);
	fixture.write(
		`enterprise_data_privacy = true

[scripts]
setup = "npm ci"
mystery = "kept"

[git]
branch_from = "main"

[prompts]
review = "Focus on tests."
`,
	);

	writeRepositoryScripts(
		writeInput(fixture.repositoryPath, { setup: 'npm ci --ignore-scripts' }),
	);

	assert.deepEqual(fixture.readRecord(), {
		enterprise_data_privacy: true,
		git: { branch_from: 'main' },
		prompts: { review: 'Focus on tests.' },
		scripts: {
			auto_run_after_setup: false,
			mystery: 'kept',
			run_mode: 'concurrent',
			setup: 'npm ci --ignore-scripts',
		},
	});
});

test('leaves an unparseable config untouched and reports the failure', (t) => {
	const fixture = createRepositoryFixture(t);
	const broken = '[scripts\nsetup = "npm ci"\n';
	fixture.write(broken);

	const result = writeRepositoryScripts(
		writeInput(fixture.repositoryPath, { setup: 'npm run bootstrap' }),
	);

	assert.equal(result.ok, false);
	assert.equal(fixture.read(), broken);
});

test('reports a failure when the config cannot be written', (t) => {
	const fixture = createRepositoryFixture(t);
	const directory = path.dirname(fixture.configPath);
	mkdirSync(directory, { recursive: true });
	chmodSync(directory, 0o500);

	const result = writeRepositoryScripts(
		writeInput(fixture.repositoryPath, { setup: 'npm ci' }),
	);
	chmodSync(directory, 0o700);

	assert.equal(result.ok, false);
	assert.equal(existsSync(fixture.configPath), false);
});
