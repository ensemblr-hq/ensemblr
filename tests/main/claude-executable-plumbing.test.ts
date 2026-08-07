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

import type { ModelInfo, Options, Query } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveClaudeExecutable } from '../../src/main/agent-providers/claude-executable.ts';
import {
	AgentClientError,
	createAgentClient,
} from '../../src/main/agent-runtime/agent-client.ts';
import type { AgentExecutableSnapshot } from '../../src/main/agent-runtime/agent-types.ts';
import { createFakeAgentAdapter } from '../../src/main/agent-runtime/fake-agent-adapter.ts';
import { createSessionOpener } from '../../src/main/agent-runtime/session/session-open.ts';
import { createClaudeAgentAdapter } from '../../src/main/claude-agent/claude-agent-adapter.ts';
import { createClaudeModelLister } from '../../src/main/claude-agent/claude-model-lister.ts';
import type { LocalCommandService } from '../../src/main/commands/local-command.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import type { AgentProviderId } from '../../src/shared/agent-provider.ts';
import type { SettingsResolutionSnapshot } from '../../src/shared/ipc/contracts/settings-resolution.ts';

const WORKSPACE_ID = 'ws-exec';
const WORKSPACE_CWD = '/tmp/ensemblr/exec/ws';
const OVERRIDE_PATH = '/opt/homebrew/bin/claude';
const EXECUTABLE_SETTING_KEY = 'claude.executablePath';
const RELATIVE_PATH_MESSAGE =
	'The claude.executablePath setting must be absolute, start with ~/, or be a bare command name.';
const UNRUNNABLE_CLAUDE_MESSAGE =
	'No runnable Claude Code executable (`claude`) was found. Install it and resolve the checks in Settings → Providers before opening a session.';

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()?.();
	}
});

function openTestDatabase(): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-exec-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'exec-test.db'),
	});
	cleanups.push(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});
	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-exec', 'exec', 'Exec', '/tmp/ensemblr/exec', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('${WORKSPACE_ID}', 'repo-exec', 'exec', 'Exec', '${WORKSPACE_CWD}');
`);
	return connection.database;
}

function createReadyPiExecutable(): PiExecutableSnapshot {
	return {
		command: '/usr/local/bin/pi',
		diagnostics: [],
		displayPath: '/usr/local/bin/pi',
		path: '/usr/local/bin/pi',
		probe: null,
		setting: null,
		source: null,
		status: 'ok',
		updatedAt: '2026-08-07T00:00:00.000Z',
	};
}

// The adapter treats the query completing as a shutdown, which would close the
// session before the opener subscribes; staying pending keeps it open.
function createPendingQuery(): Query {
	const iterator = (async function* (): AsyncGenerator<never, void> {
		await new Promise<void>(() => undefined);
	})();
	return Object.assign(iterator, {
		applyFlagSettings: async () => undefined,
		close: () => undefined,
		interrupt: async () => undefined,
		setModel: async () => undefined,
		setPermissionMode: async () => undefined,
	}) as unknown as Query;
}

/** One Claude open attempt: the SDK options captured, plus the open's outcome. */
interface ClaudeOpenAttempt {
	captured: readonly Options[];
	database: DatabaseSync;
	error: unknown;
}

/**
 * Opens one Claude session through the production opener with the given
 * per-provider executable resolver in place, capturing both the `Options` the
 * adapter handed the SDK and any error the open rejected with.
 */
async function attemptClaudeSessionWith(
	resolveProviderExecutable?: (
		provider: AgentProviderId,
	) => Promise<AgentExecutableSnapshot | null>,
): Promise<ClaudeOpenAttempt> {
	const database = openTestDatabase();
	const captured: Options[] = [];
	const agentClient = createAgentClient({
		adapters: {
			claude: createClaudeAgentAdapter({
				queryFn: ({ options }) => {
					if (options) {
						captured.push(options);
					}
					return createPendingQuery();
				},
				resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
			}),
		},
	});
	cleanups.push(() => {
		void agentClient.shutdown();
	});
	const opener = createSessionOpener({
		activeSessions: new Map(),
		agentClient,
		eventSink: undefined,
		isPlanModeActive: () => false,
		now: () => new Date('2026-08-07T00:00:00.000Z'),
		queueNaming: () => undefined,
		resolvePermissionMode: () => 'workspace-trusted',
		...(resolveProviderExecutable ? { resolveProviderExecutable } : {}),
		subscribeToRuntime: () => ({ unsubscribe: () => undefined }),
	});

	let error: unknown;
	try {
		await opener.openSession({
			database,
			request: {
				executable: createReadyPiExecutable(),
				provider: 'claude',
				workspaceCwd: WORKSPACE_CWD,
				workspaceId: WORKSPACE_ID,
			},
		});
	} catch (cause) {
		error = cause;
	}

	return { captured, database, error };
}

/** Opens a Claude session that is expected to succeed and returns its SDK options. */
async function openClaudeSessionWith(
	resolveProviderExecutable?: (
		provider: AgentProviderId,
	) => Promise<AgentExecutableSnapshot | null>,
): Promise<Options> {
	const { captured, error } = await attemptClaudeSessionWith(
		resolveProviderExecutable,
	);
	if (error) {
		throw error;
	}

	const [options] = captured;
	if (!options) {
		throw new Error('The Claude adapter never called query().');
	}
	return options;
}

describe("a configured Claude executable reaches the session's SDK options", () => {
	it('pins the override the user configured', async () => {
		const options = await openClaudeSessionWith(async () => ({
			command: OVERRIDE_PATH,
			status: 'ok',
		}));

		expect(options.pathToClaudeCodeExecutable).toBe(OVERRIDE_PATH);
	});

	it('omits the option when no resolver is wired at all', async () => {
		const options = await openClaudeSessionWith();

		expect(options).not.toHaveProperty('pathToClaudeCodeExecutable');
	});

	it('asks the resolver for the session that is actually opening', async () => {
		const asked: AgentProviderId[] = [];
		await openClaudeSessionWith(async (provider) => {
			asked.push(provider);
			return null;
		});

		expect(asked).toEqual(['claude']);
	});
});

/** Resolver that positively reports nothing runnable was found. */
const resolveUnrunnable = async (): Promise<AgentExecutableSnapshot> => ({
	command: '',
	status: 'error',
});

/** Resolver that cannot answer at all, e.g. because its settings are unreadable. */
const resolveThrowing = async (): Promise<AgentExecutableSnapshot> => {
	throw new Error('settings table is unavailable');
};

describe('a Claude session with no installed binary fails loudly', () => {
	/** Asserts an attempt rejected with the actionable install error, SDK untouched. */
	const expectRejectedAsUnrunnable = ({
		captured,
		error,
	}: ClaudeOpenAttempt): void => {
		expect(captured).toHaveLength(0);
		expect(error).toBeInstanceOf(AgentClientError);
		expect((error as AgentClientError).code).toBe('invalid-executable');
		expect((error as AgentClientError).message).toBe(UNRUNNABLE_CLAUDE_MESSAGE);
	};

	/** Reads back the status and error the open recorded on the session row. */
	const readSessionFailure = (
		database: DatabaseSync,
	): { last_error: string | null; status: string } | undefined => {
		const [row] = database
			.prepare('SELECT status, last_error FROM agent_sessions')
			.all() as { last_error: string | null; status: string }[];
		return row;
	};

	it('rejects with an actionable error instead of spawning the SDK', async () => {
		expectRejectedAsUnrunnable(
			await attemptClaudeSessionWith(resolveUnrunnable),
		);
	});

	it('fails identically when the resolver throws instead of answering', async () => {
		expectRejectedAsUnrunnable(await attemptClaudeSessionWith(resolveThrowing));
	});

	it('records the failure on the persisted session row', async () => {
		const { database } = await attemptClaudeSessionWith(resolveUnrunnable);

		expect(readSessionFailure(database)).toMatchObject({
			last_error: expect.stringContaining('No runnable Claude Code executable'),
			status: 'errored',
		});
	});

	it('records a thrown resolver on the row too, rather than leaving it starting', async () => {
		const { database } = await attemptClaudeSessionWith(resolveThrowing);

		expect(readSessionFailure(database)).toMatchObject({
			last_error: expect.stringContaining('No runnable Claude Code executable'),
			status: 'errored',
		});
	});
});

describe('a Pi session keeps launching the executable the IPC layer resolved', () => {
	it('spawns the request snapshot and never consults the provider resolver', async () => {
		const database = openTestDatabase();
		const fake = createFakeAgentAdapter();
		const asked: AgentProviderId[] = [];
		const agentClient = createAgentClient({ adapters: { pi: fake.adapter } });
		cleanups.push(() => {
			void agentClient.shutdown();
		});
		const opener = createSessionOpener({
			activeSessions: new Map(),
			agentClient,
			eventSink: undefined,
			isPlanModeActive: () => false,
			now: () => new Date('2026-08-07T00:00:00.000Z'),
			queueNaming: () => undefined,
			resolvePermissionMode: () => 'workspace-trusted',
			resolveProviderExecutable: async (provider) => {
				asked.push(provider);
				return { command: OVERRIDE_PATH, status: 'ok' };
			},
			subscribeToRuntime: () => ({ unsubscribe: () => undefined }),
		});

		await opener.openSession({
			database,
			request: {
				executable: createReadyPiExecutable(),
				provider: 'pi',
				workspaceCwd: WORKSPACE_CWD,
				workspaceId: WORKSPACE_ID,
			},
		});

		expect(asked).toEqual([]);
		expect(fake.getOpenSessions()[0]?.getSessionRequest().executable).toEqual(
			createReadyPiExecutable(),
		);
	});
});

describe('the model lister runs the same binary the session will', () => {
	const MODELS: readonly ModelInfo[] = [
		{
			displayName: 'Opus 4.5',
			supportedEffortLevels: ['low', 'high'],
			value: 'opus',
		} as ModelInfo,
	];

	/** Lists models once, returning both the SDK options built and the catalog. */
	const listWith = async (
		resolveExecutablePath?: () => Promise<string | null>,
	): Promise<{ captured: readonly Options[]; models: readonly unknown[] }> => {
		const captured: Options[] = [];
		const lister = createClaudeModelLister({
			queryFn: ({ options }) => {
				if (options) {
					captured.push(options);
				}
				return Object.assign(createPendingQuery(), {
					supportedModels: async () => MODELS,
				}) as unknown as Query;
			},
			resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
			...(resolveExecutablePath ? { resolveExecutablePath } : {}),
		});

		return { captured, models: await lister() };
	};

	it('pins the configured override', async () => {
		const { captured, models } = await listWith(async () => OVERRIDE_PATH);

		expect(captured[0]?.pathToClaudeCodeExecutable).toBe(OVERRIDE_PATH);
		// The catalog also carries pinned releases the runtime never advertises, so
		// this asserts the runtime's own row landed rather than the total count.
		expect(models).toContainEqual(expect.objectContaining({ id: 'opus' }));
	});

	it('lists nothing and never spawns when no binary resolves', async () => {
		const { captured, models } = await listWith(async () => null);

		expect(captured).toHaveLength(0);
		expect(models).toEqual([]);
	});

	it('treats an empty resolved path as "no binary", not "SDK default"', async () => {
		const { captured, models } = await listWith(async () => '');

		expect(captured).toHaveLength(0);
		expect(models).toEqual([]);
	});

	it('does not cache the unavailable result, so an install takes effect', async () => {
		const captured: Options[] = [];
		let executablePath: string | null = null;
		const lister = createClaudeModelLister({
			queryFn: ({ options }) => {
				if (options) {
					captured.push(options);
				}
				return Object.assign(createPendingQuery(), {
					supportedModels: async () => MODELS,
				}) as unknown as Query;
			},
			resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
			resolveExecutablePath: () => executablePath,
		});

		expect(await lister()).toEqual([]);
		executablePath = OVERRIDE_PATH;

		expect(await lister()).toContainEqual(
			expect.objectContaining({ id: 'opus' }),
		);
		expect(captured[0]?.pathToClaudeCodeExecutable).toBe(OVERRIDE_PATH);
	});
});

describe('a configured Claude executable path is validated, never cwd-resolved', () => {
	/** Creates a throwaway directory removed after the test. */
	const createDirectory = (): string => {
		const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-claude-path-'));
		cleanups.push(() => rmSync(directory, { force: true, recursive: true }));
		return directory;
	};

	/** Writes a runnable stub at `filePath` and returns it. */
	const createExecutable = (filePath: string): string => {
		mkdirSync(path.dirname(filePath), { recursive: true });
		writeFileSync(filePath, '#!/bin/sh\necho claude\n');
		chmodSync(filePath, 0o755);
		return filePath;
	};

	/**
	 * Builds an app-scope snapshot carrying the override as a `config-default`,
	 * the source that reaches resolution without passing the UI's normalizer.
	 */
	const settingsSnapshot = (value: string): SettingsResolutionSnapshot => ({
		app: {
			diagnostics: [],
			settings: [
				{
					candidates: [],
					key: EXECUTABLE_SETTING_KEY,
					locked: false,
					source: 'config-default',
					value,
				},
			],
		},
	});

	/** Builds a command service whose PATH holds only `pathDirectories`. */
	const createCommandService = (
		pathDirectories: readonly string[] = [],
	): LocalCommandService => ({
		getEnvironment: async () => ({
			diagnostics: [],
			env: {},
			path: pathDirectories.join(path.delimiter),
			resolvedAt: '2026-08-07T00:00:00.000Z',
			shell: '/bin/zsh',
			source: 'shell',
		}),
		run: async () => {
			throw new Error('Executable resolution must never run a command.');
		},
	});

	/** Resolves the configured override with the given PATH directories. */
	const resolveConfigured = (
		value: string,
		{
			homeDirectory,
			pathDirectories,
		}: { homeDirectory: string; pathDirectories?: readonly string[] },
	) =>
		resolveClaudeExecutable({
			homeDirectory,
			localCommandService: createCommandService(pathDirectories),
			settingsSnapshot: settingsSnapshot(value),
		});

	it('rejects a relative path with the rule the user has to follow', async () => {
		const resolution = await resolveConfigured('bin/claude-wrapper', {
			homeDirectory: createDirectory(),
		});

		expect(resolution).toMatchObject({ path: '', status: 'error' });
		expect(resolution.message).toBe(RELATIVE_PATH_MESSAGE);
	});

	it('refuses a relative path even when one resolves off the process cwd', async () => {
		const directory = createDirectory();
		const trap = createExecutable(
			path.join(directory, 'bin', 'claude-wrapper'),
		);

		const resolution = await resolveConfigured(
			path.relative(process.cwd(), trap),
			{ homeDirectory: directory },
		);

		expect(resolution.path).not.toBe(trap);
		expect(resolution).toMatchObject({ path: '', status: 'error' });
	});

	it('still runs an absolute override', async () => {
		const directory = createDirectory();
		const executable = createExecutable(
			path.join(directory, 'custom', 'claude'),
		);

		const resolution = await resolveConfigured(executable, {
			homeDirectory: directory,
		});

		expect(resolution).toMatchObject({ path: executable, status: 'ok' });
	});

	it('still expands a ~/-prefixed override against the home directory', async () => {
		const directory = createDirectory();
		const executable = createExecutable(path.join(directory, 'bin', 'claude'));

		const resolution = await resolveConfigured('~/bin/claude', {
			homeDirectory: directory,
		});

		expect(resolution).toMatchObject({ path: executable, status: 'ok' });
	});

	it('still resolves a bare command name on the shell PATH', async () => {
		const directory = createDirectory();
		const executable = createExecutable(
			path.join(directory, 'bin', 'claude-wrapper'),
		);

		const resolution = await resolveConfigured('claude-wrapper', {
			homeDirectory: directory,
			pathDirectories: [path.dirname(executable)],
		});

		expect(resolution).toMatchObject({ path: executable, status: 'ok' });
	});
});
