import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { load } from 'js-toml';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const handle = vi.fn();

vi.mock('electron', () => ({ ipcMain: { handle } }));

const { registerWorkspaceScriptHandlers } = await import(
	'../../src/main/ipc/handlers/workspace-scripts.ts'
);
const { insertRepositoryRow } = await import(
	'../../src/main/storage/repositories/repository-row-repository.ts'
);
const { openEnsemblrDatabase } = await import(
	'../../src/main/storage/database.ts'
);

const REPOSITORY_ID = 'repo-1';

let database: DatabaseSync;
let databaseDirectory: string;
let repositoryPath: string;

/** Invokes the registered `update-repository-scripts` handler with a payload. */
function invokeUpdate(request: unknown): { ok: boolean } {
	const registration = handle.mock.calls.find(
		([channel]) => channel === 'ensemblr:update-repository-scripts',
	);

	if (!registration) {
		throw new Error('update-repository-scripts handler was not registered');
	}

	return registration[1](null, request);
}

/** A valid Scripts-settings payload, with per-test overrides. */
function updateRequest(overrides: Record<string, unknown> = {}) {
	return {
		archive: null,
		autoRunAfterSetup: false,
		repositoryId: REPOSITORY_ID,
		runScriptMode: 'concurrent',
		runScripts: [],
		setup: 'npm ci',
		...overrides,
	};
}

/** Reads the written config back as a plain record. */
function readConfig(): Record<string, unknown> {
	const configPath = path.join(repositoryPath, '.ensemblr', 'settings.toml');

	return JSON.parse(
		JSON.stringify(load(readFileSync(configPath, 'utf8'))),
	) as Record<string, unknown>;
}

beforeEach(() => {
	handle.mockClear();
	repositoryPath = mkdtempSync(path.join(tmpdir(), 'ensemblr-handler-'));
	databaseDirectory = mkdtempSync(path.join(tmpdir(), 'ensemblr-handler-db-'));
	database = openEnsemblrDatabase({
		databasePath: path.join(databaseDirectory, 'ensemblr-test.db'),
	}).database;
	insertRepositoryRow({
		database,
		defaultBranch: 'main',
		id: REPOSITORY_ID,
		metadataJson: '{}',
		name: 'repo',
		path: repositoryPath,
		remoteUrl: '',
		slug: 'repo',
		timestamp: new Date().toISOString(),
	});

	registerWorkspaceScriptHandlers({
		databaseService: { getConnection: () => ({ database }) },
		scriptLifecycleService: {},
	} as unknown as Parameters<typeof registerWorkspaceScriptHandlers>[0]);
});

afterEach(() => {
	database.close();
	rmSync(databaseDirectory, { force: true, recursive: true });
	rmSync(repositoryPath, { force: true, recursive: true });
});

test('writes the repository root committed config', () => {
	const result = invokeUpdate(
		updateRequest({
			runScripts: [
				{
					availableIn: ['local'],
					command: 'npm run dev',
					icon: 'play',
					isDefault: true,
					name: 'dev',
				},
			],
		}),
	);

	expect(result).toEqual({ ok: true });
	expect(readConfig()).toEqual({
		scripts: {
			auto_run_after_setup: false,
			run: {
				dev: {
					available_in: ['local'],
					command: 'npm run dev',
					default: true,
				},
			},
			run_mode: 'concurrent',
			setup: 'npm ci',
		},
	});
});

test('refuses a repository id the app does not track', () => {
	const result = invokeUpdate(updateRequest({ repositoryId: 'unknown-repo' }));

	expect(result).toEqual({ ok: false });
	expect(
		existsSync(path.join(repositoryPath, '.ensemblr', 'settings.toml')),
	).toBe(false);
});

test('refuses a malformed payload without touching the config', () => {
	const result = invokeUpdate(updateRequest({ runScriptMode: 'sideways' }));

	expect(result).toEqual({ ok: false });
	expect(
		existsSync(path.join(repositoryPath, '.ensemblr', 'settings.toml')),
	).toBe(false);
});

test('refuses duplicate run script names rather than dropping one', () => {
	const duplicate = (command: string) => ({
		availableIn: null,
		command,
		icon: 'play',
		isDefault: false,
		name: 'dev',
	});

	const result = invokeUpdate(
		updateRequest({
			runScripts: [duplicate('npm run dev'), duplicate('npm run dev:alt')],
		}),
	);

	expect(result).toEqual({ ok: false });
	expect(
		existsSync(path.join(repositoryPath, '.ensemblr', 'settings.toml')),
	).toBe(false);
});
