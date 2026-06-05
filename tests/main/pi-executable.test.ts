import assert from 'node:assert/strict';
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import type {
	LocalCommandFailureCode,
	LocalCommandRequest,
	LocalCommandResult,
	LocalCommandService,
} from '../../src/main/commands/local-command.ts';
import {
	ENSEMBLE_CONFIG_SCHEMA_VERSION,
	type EnsembleConfig,
} from '../../src/main/config/config-loader.ts';
import { resolveSettings } from '../../src/main/config/config-resolution.ts';
import {
	resolvePiExecutable,
	savePiExecutableOverride,
} from '../../src/main/pi/pi-executable.ts';
import { openEnsembleDatabase } from '../../src/main/storage/database.ts';
import type { SettingsResolutionSnapshot } from '../../src/shared/ipc.ts';

const NOW = new Date('2026-06-05T00:00:00.000Z');

let settingCounter = 0;

interface FakeCommandOutcome {
	exitCode?: number | null;
	failureCode?: LocalCommandFailureCode;
	failureMessage?: string;
	status?: LocalCommandResult['status'];
	stderr?: string;
	stdout?: string;
}

function createConfig(overrides: Partial<EnsembleConfig> = {}): EnsembleConfig {
	return {
		app: {},
		environment: {},
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: ENSEMBLE_CONFIG_SCHEMA_VERSION,
		security: {},
		ui: {},
		...overrides,
	};
}

function createDirectoryFixture(t: TestContext): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemble-pi-'));

	t.after(() => {
		rmSync(directory, { force: true, recursive: true });
	});

	return directory;
}

function createDatabaseFixture(t: TestContext): DatabaseSync {
	const directory = createDirectoryFixture(t);
	const connection = openEnsembleDatabase({
		databasePath: path.join(directory, 'ensemble-test.db'),
	});

	t.after(() => {
		connection.database.close();
	});

	return connection.database;
}

function createExecutable(filePath: string): string {
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, '#!/bin/sh\nprintf "fixture executable"\n');
	chmodSync(filePath, 0o755);

	return filePath;
}

function createSettingsSnapshot({
	config = createConfig(),
	database = null,
	homeDirectory,
}: {
	config?: EnsembleConfig;
	database?: DatabaseSync | null;
	homeDirectory: string;
}): SettingsResolutionSnapshot {
	return resolveSettings({
		config,
		database,
		homeDirectory,
	});
}

function insertAppSetting({
	database,
	key,
	value,
}: {
	database: DatabaseSync;
	key: string;
	value: unknown;
}): void {
	settingCounter += 1;
	database
		.prepare(
			`INSERT INTO settings (id, scope, scope_id, key, value_json)
			 VALUES (?, 'app', '', ?, ?)`,
		)
		.run(`pi-setting-${settingCounter}`, key, JSON.stringify(value));
}

function createLocalCommandService({
	pathEntries = [],
	probeResults = {},
	requests,
}: {
	pathEntries?: readonly string[];
	probeResults?: Record<string, FakeCommandOutcome>;
	requests?: LocalCommandRequest[];
} = {}): LocalCommandService {
	return {
		getEnvironment: async () => ({
			diagnostics: [],
			env: {
				PATH: pathEntries.join(path.delimiter),
				PI_CODING_AGENT_DIR: '/Users/alice/.pi/agent',
			},
			path: pathEntries.join(path.delimiter),
			resolvedAt: NOW.toISOString(),
			shell: '/bin/sh',
			source: 'shell',
		}),
		run: async (request) => {
			requests?.push(request);

			const args = Array.from(request.args ?? []);
			const outcome = probeResults[formatCommandKey(request.command, args)] ?? {
				stdout: 'pi version 1.2.3',
			};
			return createLocalCommandResult(request.command, args, outcome);
		},
	};
}

function createLocalCommandResult(
	command: string,
	args: string[],
	outcome: FakeCommandOutcome,
): LocalCommandResult {
	const status = outcome.status ?? 'success';
	const exitCode =
		outcome.exitCode ??
		(status === 'success'
			? 0
			: outcome.failureCode === 'command-not-found'
				? null
				: 1);
	const failure =
		status === 'success'
			? undefined
			: {
					code: outcome.failureCode ?? 'nonzero-exit',
					exitCode,
					message:
						outcome.failureMessage ??
						`Command exited with code ${String(exitCode)}.`,
					signal: null,
				};
	const stdout = outcome.stdout ?? '';
	const stderr = outcome.stderr ?? '';

	return {
		args,
		command,
		cwd: '/tmp',
		durationMs: 1,
		endedAt: NOW.toISOString(),
		environment: null,
		exitCode,
		failure,
		logs: {
			command: formatCommandKey(command, args),
			cwd: '/tmp',
			env: {},
			stderr,
			stdout,
		},
		signal: null,
		startedAt: NOW.toISOString(),
		status,
		stderr,
		stderrTruncated: false,
		stdout,
		stdoutTruncated: false,
	};
}

function formatCommandKey(command: string, args: string[]): string {
	return [command, ...args].join(' ');
}

test('uses app.pi.executablePath from declarative config', async (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const executablePath = createExecutable(
		path.join(homeDirectory, 'bin', 'oh-my-pi'),
	);
	const requests: LocalCommandRequest[] = [];
	const snapshot = await resolvePiExecutable({
		homeDirectory,
		localCommandService: createLocalCommandService({ requests }),
		now: () => NOW,
		settingsSnapshot: createSettingsSnapshot({
			config: createConfig({
				app: {
					pi: {
						executablePath: '~/bin/oh-my-pi',
					},
				},
			}),
			homeDirectory,
		}),
	});

	assert.equal(snapshot.status, 'ok');
	assert.equal(snapshot.path, executablePath);
	assert.equal(snapshot.source, 'config-default');
	assert.equal(snapshot.probe?.kind, 'version');
	assert.equal(requests[0]?.command, executablePath);
	assert.equal(requests[0]?.env, undefined);
});

test('uses SQLite override before config default', async (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const database = createDatabaseFixture(t);
	const configPath = createExecutable(path.join(homeDirectory, 'bin', 'pi'));
	const sqlitePath = createExecutable(
		path.join(homeDirectory, 'override', 'pi'),
	);

	insertAppSetting({
		database,
		key: 'pi.executablePath',
		value: sqlitePath,
	});

	const snapshot = await resolvePiExecutable({
		homeDirectory,
		localCommandService: createLocalCommandService(),
		now: () => NOW,
		settingsSnapshot: createSettingsSnapshot({
			config: createConfig({
				app: {
					pi: {
						executablePath: configPath,
					},
				},
			}),
			database,
			homeDirectory,
		}),
	});

	assert.equal(snapshot.status, 'ok');
	assert.equal(snapshot.path, sqlitePath);
	assert.equal(snapshot.source, 'sqlite');
});

test('invalid explicit override fails without falling back to PATH', async (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const pathDirectory = path.join(homeDirectory, 'path-bin');
	createExecutable(path.join(pathDirectory, 'pi'));

	const snapshot = await resolvePiExecutable({
		homeDirectory,
		localCommandService: createLocalCommandService({
			pathEntries: [pathDirectory],
		}),
		now: () => NOW,
		settingsSnapshot: createSettingsSnapshot({
			config: createConfig({
				app: {
					pi: {
						executablePath: '~/missing/pi',
					},
				},
			}),
			homeDirectory,
		}),
	});

	assert.equal(snapshot.status, 'error');
	assert.equal(snapshot.path, '');
	assert.equal(snapshot.source, 'config-default');
	assert.equal(
		snapshot.diagnostics.some(
			(diagnostic) => diagnostic.code === 'pi-executable-missing',
		),
		true,
	);
});

test('discovers pi from shell PATH when no override is configured', async (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const pathDirectory = path.join(homeDirectory, 'path-bin');
	const executablePath = createExecutable(path.join(pathDirectory, 'pi'));

	const snapshot = await resolvePiExecutable({
		homeDirectory,
		localCommandService: createLocalCommandService({
			pathEntries: [pathDirectory],
		}),
		now: () => NOW,
		settingsSnapshot: createSettingsSnapshot({ homeDirectory }),
	});

	assert.equal(snapshot.status, 'ok');
	assert.equal(snapshot.path, executablePath);
	assert.equal(snapshot.source, 'path');
});

test('discovers pi from common local binary locations when PATH misses', async (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const executablePath = createExecutable(
		path.join(homeDirectory, '.local', 'bin', 'pi'),
	);

	const snapshot = await resolvePiExecutable({
		commonCandidatePaths: ['~/.local/bin/pi'],
		homeDirectory,
		localCommandService: createLocalCommandService(),
		now: () => NOW,
		settingsSnapshot: createSettingsSnapshot({ homeDirectory }),
	});

	assert.equal(snapshot.status, 'ok');
	assert.equal(snapshot.path, executablePath);
	assert.equal(snapshot.source, 'common-location');
});

test('supports explicit bare wrapper commands through PATH', async (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const pathDirectory = path.join(homeDirectory, 'path-bin');
	const wrapperPath = createExecutable(path.join(pathDirectory, 'oh-my-pi'));

	const snapshot = await resolvePiExecutable({
		homeDirectory,
		localCommandService: createLocalCommandService({
			pathEntries: [pathDirectory],
		}),
		now: () => NOW,
		settingsSnapshot: createSettingsSnapshot({
			config: createConfig({
				app: {
					pi: {
						executablePath: 'oh-my-pi',
					},
				},
			}),
			homeDirectory,
		}),
	});

	assert.equal(snapshot.status, 'ok');
	assert.equal(snapshot.path, wrapperPath);
	assert.equal(snapshot.source, 'config-default');
});

test('warns when version and help probes fail for an executable candidate', async (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const pathDirectory = path.join(homeDirectory, 'path-bin');
	const executablePath = createExecutable(path.join(pathDirectory, 'pi'));

	const snapshot = await resolvePiExecutable({
		homeDirectory,
		localCommandService: createLocalCommandService({
			pathEntries: [pathDirectory],
			probeResults: {
				[`${executablePath} --help`]: {
					exitCode: 64,
					failureCode: 'nonzero-exit',
					status: 'failure',
					stderr: 'unsupported',
				},
				[`${executablePath} --version`]: {
					exitCode: 64,
					failureCode: 'nonzero-exit',
					status: 'failure',
					stderr: 'unsupported',
				},
			},
		}),
		now: () => NOW,
		settingsSnapshot: createSettingsSnapshot({ homeDirectory }),
	});

	assert.equal(snapshot.status, 'warning');
	assert.equal(snapshot.probe?.status, 'failure');
	assert.equal(
		snapshot.diagnostics.some(
			(diagnostic) =>
				diagnostic.code === 'pi-executable-probe-unsupported' &&
				diagnostic.severity === 'warning',
		),
		true,
	);
});

test('persists manual selection as the app-level SQLite override', (t) => {
	const homeDirectory = createDirectoryFixture(t);
	const database = createDatabaseFixture(t);
	const firstPath = path.join(homeDirectory, 'bin', 'pi');
	const secondPath = path.join(homeDirectory, 'bin', 'oh-my-pi');

	const firstResult = savePiExecutableOverride({
		database,
		executablePath: firstPath,
	});
	const secondResult = savePiExecutableOverride({
		database,
		executablePath: secondPath,
	});
	const rows = database
		.prepare(
			`SELECT key, scope, scope_id, source, value_json
			 FROM settings
			 WHERE key = 'pi.executablePath'`,
		)
		.all() as Array<{
		key: string;
		scope: string;
		scope_id: string;
		source: string;
		value_json: string;
	}>;

	assert.equal(firstResult.selectedPath, firstPath);
	assert.equal(secondResult.selectedPath, secondPath);
	assert.equal(rows.length, 1);
	assert.deepEqual(
		{
			key: rows[0]?.key,
			scope: rows[0]?.scope,
			scope_id: rows[0]?.scope_id,
			source: rows[0]?.source,
			value: JSON.parse(rows[0]?.value_json ?? 'null'),
		},
		{
			key: 'pi.executablePath',
			scope: 'app',
			scope_id: '',
			source: 'sqlite',
			value: secondPath,
		},
	);
});
