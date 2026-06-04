import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	createPiductorConfigService,
	loadPiductorConfig,
	PIDUCTOR_CONFIG_SCHEMA_VERSION,
	resolvePiductorConfigPath,
} from '../../src/main/config/config-loader.ts';

function createConfigFixture(): {
	cleanup: () => void;
	configPath: string;
	homeDirectory: string;
	writeConfig: (source: string) => void;
} {
	const homeDirectory = mkdtempSync(path.join(tmpdir(), 'piductor-config-'));
	const configPath = resolvePiductorConfigPath(homeDirectory);

	return {
		cleanup: () => rmSync(homeDirectory, { force: true, recursive: true }),
		configPath,
		homeDirectory,
		writeConfig: (source) => {
			mkdirSync(path.dirname(configPath), { recursive: true });
			writeFileSync(configPath, source);
		},
	};
}

function fixedClock() {
	return new Date('2026-06-04T12:00:00.000Z');
}

test('resolves the declarative config path under ~/.config/piductor', () => {
	assert.equal(
		resolvePiductorConfigPath('/Users/example'),
		'/Users/example/.config/piductor/config.json',
	);
});

test('treats a missing config file as empty non-blocking config', (t) => {
	const fixture = createConfigFixture();
	t.after(fixture.cleanup);

	const result = loadPiductorConfig({
		homeDirectory: fixture.homeDirectory,
		now: fixedClock,
	});

	assert.deepEqual(result.config, {
		app: {},
		environment: {},
		managed: {},
		repositoryDefaults: {},
		repositoryRules: [],
		schemaVersion: PIDUCTOR_CONFIG_SCHEMA_VERSION,
		security: {},
		ui: {},
	});
	assert.equal(result.snapshot.path, fixture.configPath);
	assert.equal(result.snapshot.displayPath, '~/.config/piductor/config.json');
	assert.equal(result.snapshot.loadedAt, '2026-06-04T12:00:00.000Z');
	assert.equal(result.snapshot.status, 'missing');
	assert.equal(result.snapshot.blocksReadiness, false);
	assert.equal(result.snapshot.schemaVersion, PIDUCTOR_CONFIG_SCHEMA_VERSION);
	assert.equal(result.snapshot.diagnostics[0]?.code, 'config-missing');
});

test('loads a valid minimal v1 config without diagnostics', (t) => {
	const fixture = createConfigFixture();
	t.after(fixture.cleanup);
	fixture.writeConfig(
		JSON.stringify({
			app: { sendShortcut: 'enter' },
			managed: { locked: { rootDirectory: true } },
			repositoryDefaults: { branchPrefix: 'piductor/' },
			repositoryRules: [{ match: 'github.com/example/*' }],
			schemaVersion: 1,
			ui: { theme: 'system' },
		}),
	);

	const result = loadPiductorConfig({
		homeDirectory: fixture.homeDirectory,
		now: fixedClock,
	});

	assert.equal(result.snapshot.status, 'ok');
	assert.equal(result.snapshot.blocksReadiness, false);
	assert.equal(result.snapshot.schemaVersion, 1);
	assert.deepEqual(result.snapshot.diagnostics, []);
	assert.deepEqual(result.config.app, { sendShortcut: 'enter' });
	assert.deepEqual(result.config.repositoryRules, [
		{ match: 'github.com/example/*' },
	]);
});

test('reports invalid JSON with line and column diagnostics', (t) => {
	const fixture = createConfigFixture();
	t.after(fixture.cleanup);
	fixture.writeConfig('{\n  "schemaVersion": 1,\n}');

	const result = loadPiductorConfig({
		homeDirectory: fixture.homeDirectory,
		now: fixedClock,
	});

	assert.equal(result.snapshot.status, 'invalid');
	assert.equal(result.snapshot.blocksReadiness, false);
	assert.equal(result.snapshot.schemaVersion, null);
	assert.equal(result.snapshot.diagnostics[0]?.code, 'invalid-json');
	assert.equal(result.snapshot.diagnostics[0]?.severity, 'error');
	assert.equal(typeof result.snapshot.diagnostics[0]?.line, 'number');
	assert.equal(typeof result.snapshot.diagnostics[0]?.column, 'number');
});

test('blocks readiness for invalid JSON when trusted managed config is required', (t) => {
	const fixture = createConfigFixture();
	t.after(fixture.cleanup);
	fixture.writeConfig('{"schemaVersion": 1,');

	const result = loadPiductorConfig({
		homeDirectory: fixture.homeDirectory,
		now: fixedClock,
		requireTrustedManagedConfig: true,
	});

	assert.equal(result.snapshot.status, 'invalid');
	assert.equal(result.snapshot.blocksReadiness, true);
});

test('surfaces unsupported schema versions without blocking non-managed readiness', (t) => {
	const fixture = createConfigFixture();
	t.after(fixture.cleanup);
	fixture.writeConfig(JSON.stringify({ schemaVersion: 999, ui: {} }));

	const result = loadPiductorConfig({
		homeDirectory: fixture.homeDirectory,
		now: fixedClock,
	});

	assert.equal(result.snapshot.status, 'invalid');
	assert.equal(result.snapshot.schemaVersion, 999);
	assert.equal(result.snapshot.blocksReadiness, false);
	assert.equal(
		result.snapshot.diagnostics.some(
			(diagnostic) => diagnostic.code === 'unsupported-schema-version',
		),
		true,
	);
});

test('blocks readiness when parseable managed config is invalid', (t) => {
	const fixture = createConfigFixture();
	t.after(fixture.cleanup);
	fixture.writeConfig(JSON.stringify({ managed: [], schemaVersion: 1 }));

	const result = loadPiductorConfig({
		homeDirectory: fixture.homeDirectory,
		now: fixedClock,
	});

	assert.equal(result.snapshot.status, 'invalid');
	assert.equal(result.snapshot.blocksReadiness, true);
	assert.equal(
		result.snapshot.diagnostics.some(
			(diagnostic) =>
				diagnostic.code === 'invalid-section-type' &&
				diagnostic.fieldPath === '$.managed',
		),
		true,
	);
});

test('rejects raw secret-like string values in config', (t) => {
	const fixture = createConfigFixture();
	t.after(fixture.cleanup);
	fixture.writeConfig(
		JSON.stringify({
			environment: {
				LINEAR_TOKEN: 'lin-raw-token',
			},
			schemaVersion: 1,
		}),
	);

	const result = loadPiductorConfig({
		homeDirectory: fixture.homeDirectory,
		now: fixedClock,
	});

	assert.equal(result.snapshot.status, 'invalid');
	assert.equal(result.snapshot.blocksReadiness, false);
	assert.equal(
		result.snapshot.diagnostics.some(
			(diagnostic) =>
				diagnostic.code === 'raw-secret-value' &&
				diagnostic.fieldPath === '$.environment.LINEAR_TOKEN',
		),
		true,
	);
	assert.equal(
		JSON.stringify(result.snapshot).includes('lin-raw-token'),
		false,
	);
	assert.equal(JSON.stringify(result.config).includes('lin-raw-token'), false);
	assert.deepEqual(result.config.environment, {});
});

test('config service caches the startup load result', (t) => {
	const fixture = createConfigFixture();
	t.after(fixture.cleanup);
	fixture.writeConfig(
		JSON.stringify({ schemaVersion: 1, ui: { theme: 'dark' } }),
	);

	const service = createPiductorConfigService({
		homeDirectory: fixture.homeDirectory,
		now: fixedClock,
	});

	assert.equal(service.load().status, 'ok');

	fixture.writeConfig('{"schemaVersion": 1,');

	assert.equal(service.getSnapshot().status, 'ok');
	assert.deepEqual(service.getConfig().ui, { theme: 'dark' });
});
