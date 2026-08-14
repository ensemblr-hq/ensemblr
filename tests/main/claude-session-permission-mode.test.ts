import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type {
	Options,
	Query,
	SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentClient } from '../../src/main/agent-runtime/agent-client.ts';
import { createAgentSessionService } from '../../src/main/agent-runtime/agent-session-service.ts';
import type { AgentSubscription } from '../../src/main/agent-runtime/agent-types.ts';
import { createSessionOpener } from '../../src/main/agent-runtime/session/session-open.ts';
import { createClaudeAgentAdapter } from '../../src/main/claude-agent/claude-agent-adapter.ts';
import type {
	ClaudeApprovalGate,
	ClaudeCanUseTool,
} from '../../src/main/claude-agent/claude-permission-bridge.ts';
import { createPiCliRpcAdapter } from '../../src/main/pi-agent/pi-cli-rpc-adapter.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import {
	createEnsemblrDatabaseService,
	openEnsemblrDatabase,
} from '../../src/main/storage/database.ts';
import { createAgentSession } from '../../src/main/storage/repositories/agent-session-repository.ts';
import type { PermissionMode } from '../../src/shared/permissions.ts';
import { CONTEXT_USAGE } from './helpers/claude-context-usage.ts';

const WORKSPACE_ID = 'ws-perm';
const WORKSPACE_CWD = '/tmp/ensemblr/perm/ws';
const MUTATING_TOOLS = [
	'Bash',
	'BashOutput',
	'Edit',
	'KillShell',
	'NotebookEdit',
	'Write',
];

// Every session here opens under the default `ensemblr` delegation mechanism,
// which denies Claude's own sub-agent tool on top of whatever the permission
// mode already withheld. `claude-subagent-mode.test.ts` owns that axis; these
// assertions carry it so a permission-mode change cannot silently drop it.
const NATIVE_SUBAGENT_TOOLS = ['Agent', 'Task'];

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()?.();
	}
});

function openTestDatabase(): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-perm-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'perm-test.db'),
	});
	cleanups.push(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});
	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-perm', 'perm', 'Perm', '/tmp/ensemblr/perm', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('${WORKSPACE_ID}', 'repo-perm', 'perm', 'Perm', '${WORKSPACE_CWD}');
`);
	return connection.database;
}

function createReadyExecutable(): PiExecutableSnapshot {
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

// The adapter subscribes to the query and treats its completion as a shutdown,
// which would close the session before the opener can subscribe. Staying
// pending keeps the session open for the assertions.
function createPendingQuery(): Query {
	const iterator = (async function* (): AsyncGenerator<SDKMessage, void> {
		await new Promise<void>(() => undefined);
	})();
	return Object.assign(iterator, {
		applyFlagSettings: async () => undefined,
		close: () => undefined,
		getContextUsage: async () => CONTEXT_USAGE,
		interrupt: async () => undefined,
		setMaxThinkingTokens: async () => undefined,
		setModel: async () => undefined,
		setPermissionMode: async () => undefined,
	}) as unknown as Query;
}

const noSubscription: AgentSubscription = { unsubscribe: () => undefined };

/**
 * Opens a Claude session through the production opener — real database, real
 * AgentClient, real Claude adapter — and returns the `Options` the adapter
 * handed to the SDK's `query()`, plus the `agent_sessions.id` of each session it
 * opened. The permission mode is read through a getter so a test can change it
 * between opens, exactly as a user changing the workspace setting does.
 */
async function openClaudeSessions({
	canUseTool,
	mode,
	opens,
	planMode = () => false,
}: {
	canUseTool?: ClaudeApprovalGate;
	mode: () => PermissionMode;
	opens: ReadonlyArray<{ planMode?: boolean }>;
	planMode?: (sessionId: string) => boolean;
}): Promise<{ options: readonly Options[]; sessionIds: readonly string[] }> {
	const database = openTestDatabase();
	const captured: Options[] = [];
	const agentClient = createAgentClient({
		adapters: {
			claude: createClaudeAgentAdapter({
				canUseTool,
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
	const opener = createSessionOpener({
		activeSessions: new Map(),
		agentClient,
		eventSink: undefined,
		isPlanModeActive: planMode,
		now: () => new Date('2026-08-07T00:00:00.000Z'),
		queueNaming: () => undefined,
		resolvePermissionMode: mode,
		subscribeToRuntime: () => noSubscription,
	});

	const sessionIds: string[] = [];
	for (const open of opens) {
		const snapshot = await opener.openSession({
			database,
			request: {
				executable: createReadyExecutable(),
				provider: 'claude',
				workspaceCwd: WORKSPACE_CWD,
				workspaceId: WORKSPACE_ID,
				...(open.planMode === undefined ? {} : { planMode: open.planMode }),
			},
		});
		sessionIds.push(snapshot.id);
	}

	cleanups.push(() => {
		void agentClient.shutdown();
	});
	return { options: captured, sessionIds };
}

/** Opens one Claude session and returns the SDK options it produced. */
async function openClaudeSession(input: {
	canUseTool?: ClaudeApprovalGate;
	mode: PermissionMode;
	planMode?: boolean;
	registryPlanMode?: boolean;
}): Promise<Options> {
	const {
		options: [options],
	} = await openClaudeSessions({
		canUseTool: input.canUseTool,
		mode: () => input.mode,
		opens: [input.planMode === undefined ? {} : { planMode: input.planMode }],
		planMode: () => input.registryPlanMode === true,
	});
	if (!options) {
		throw new Error('The Claude adapter never called query().');
	}
	return options;
}

describe('Claude session options: the workspace permission mode reaches the SDK', () => {
	it('leaves a workspace-trusted workspace exactly as permissive as it is today', async () => {
		const options = await openClaudeSession({ mode: 'workspace-trusted' });

		expect(options.permissionMode).toBe('bypassPermissions');
		expect(options.allowDangerouslySkipPermissions).toBe(true);
		expect(options.disallowedTools).toEqual(NATIVE_SUBAGENT_TOOLS);
		expect(options.canUseTool).toBeUndefined();
	});

	it('plans and withholds the mutating tools when the user picked read-only', async () => {
		const options = await openClaudeSession({ mode: 'read-only' });

		expect(options.permissionMode).toBe('plan');
		expect(options.disallowedTools).toEqual([
			...MUTATING_TOOLS,
			...NATIVE_SUBAGENT_TOOLS,
		]);
	});

	it('gates each tool call when the user picked approval-required', async () => {
		const options = await openClaudeSession({ mode: 'approval-required' });

		expect(options.permissionMode).toBe('default');
		expect(typeof options.canUseTool).toBe('function');
	});

	it('never leaves skip-permissions on for a mode the user tightened', async () => {
		for (const mode of ['read-only', 'approval-required'] as const) {
			const options = await openClaudeSession({ mode });

			expect(options.allowDangerouslySkipPermissions).not.toBe(true);
			expect(options.permissionMode).not.toBe('bypassPermissions');
		}
	});

	it('reads the mode per open, so a change between sessions takes effect', async () => {
		let opens = 0;
		const {
			options: [first, second],
		} = await openClaudeSessions({
			mode: () => {
				opens += 1;
				return opens === 1 ? 'workspace-trusted' : 'read-only';
			},
			opens: [{}, {}],
		});

		expect(first?.permissionMode).toBe('bypassPermissions');
		expect(second?.permissionMode).toBe('plan');
	});
});

describe('Claude session options: the approval seam', () => {
	it('hands approval-required the injected handler, untouched', async () => {
		const approve: ClaudeCanUseTool = async (_toolName, input) => ({
			behavior: 'allow',
			updatedInput: input,
		});

		const options = await openClaudeSession({
			canUseTool: () => ({ canUseTool: approve, release: () => undefined }),
			mode: 'approval-required',
		});

		expect(options.canUseTool).toBe(approve);
	});

	it('opens the gate with the agent_sessions.id the renderer keys the card by', async () => {
		const opened: string[] = [];

		const { sessionIds } = await openClaudeSessions({
			canUseTool: ({ agentSessionId }) => {
				opened.push(agentSessionId);
				return {
					canUseTool: async (_toolName, input) => ({
						behavior: 'allow',
						updatedInput: input,
					}),
					release: () => undefined,
				};
			},
			mode: () => 'approval-required',
			opens: [{}],
		});

		expect(opened).toEqual(sessionIds);
	});

	it('never installs the handler for a mode that asks nobody', async () => {
		const approve: ClaudeCanUseTool = async (_toolName, input) => ({
			behavior: 'allow',
			updatedInput: input,
		});

		for (const mode of ['workspace-trusted', 'read-only'] as const) {
			const options = await openClaudeSession({
				canUseTool: () => ({ canUseTool: approve, release: () => undefined }),
				mode,
			});

			expect(options.canUseTool).toBeUndefined();
		}
	});

	it('allows and warns rather than denying when no handler is wired', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		cleanups.push(() => warn.mockRestore());
		const options = await openClaudeSession({ mode: 'approval-required' });

		const decision = await options.canUseTool?.(
			'Bash',
			{ command: 'ls' },
			{
				requestId: 'req-1',
				signal: new AbortController().signal,
				toolUseID: 'tool-1',
			},
		);

		expect(decision).toEqual({
			behavior: 'allow',
			updatedInput: { command: 'ls' },
		});
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe("Claude session options: the chat's Plan Mode toggle", () => {
	it('opens the session in plan mode when the chat toggle is on', async () => {
		const options = await openClaudeSession({
			mode: 'workspace-trusted',
			planMode: true,
		});

		expect(options.permissionMode).toBe('plan');
	});

	it('honours the plan-mode registry when the request states no opinion', async () => {
		const options = await openClaudeSession({
			mode: 'workspace-trusted',
			registryPlanMode: true,
		});

		expect(options.permissionMode).toBe('plan');
	});

	it('keeps a trusted workspace trusted while it plans', async () => {
		const options = await openClaudeSession({
			mode: 'workspace-trusted',
			planMode: true,
		});

		expect(options.allowDangerouslySkipPermissions).toBe(true);
	});

	it('leaves the workspace mode alone when the toggle is off', async () => {
		const options = await openClaudeSession({
			mode: 'workspace-trusted',
			planMode: false,
		});

		expect(options.permissionMode).toBe('bypassPermissions');
	});
});

/**
 * Opens a Pi session through the same opener and returns the argv the Pi
 * adapter spawned with. The spawner throws so no child is created; the adapter
 * turns that into a spawn-failure session, and the argv is captured first.
 */
async function openPiSessionArgs(input: {
	mode: PermissionMode;
	planMode: boolean;
}): Promise<readonly string[]> {
	const database = openTestDatabase();
	let args: readonly string[] = [];
	const agentClient = createAgentClient({
		adapters: {
			pi: createPiCliRpcAdapter({
				resolveBaseEnv: () => ({ PATH: '/usr/bin' }),
				spawn: (spawnInput) => {
					args = spawnInput.args;
					throw new Error('no child in this test');
				},
			}),
		},
	});
	const opener = createSessionOpener({
		activeSessions: new Map(),
		agentClient,
		eventSink: undefined,
		isPlanModeActive: () => input.planMode,
		now: () => new Date('2026-08-07T00:00:00.000Z'),
		queueNaming: () => undefined,
		resolvePermissionMode: () => input.mode,
		subscribeToRuntime: () => noSubscription,
	});

	await opener.openSession({
		database,
		request: {
			executable: createReadyExecutable(),
			model: 'openai/gpt-test',
			provider: 'pi',
			thinkingLevel: 'high',
			workspaceCwd: WORKSPACE_CWD,
			workspaceId: WORKSPACE_ID,
		},
	});

	cleanups.push(() => {
		void agentClient.shutdown();
	});
	return args;
}

describe('Pi sessions are untouched by the permission mode', () => {
	it('spawns the same argv under every mode, plan mode included', async () => {
		const trusted = await openPiSessionArgs({
			mode: 'workspace-trusted',
			planMode: false,
		});
		const readOnly = await openPiSessionArgs({
			mode: 'read-only',
			planMode: true,
		});

		const withoutSessionId = (args: readonly string[]): readonly string[] =>
			args.slice(0, args.indexOf('--session-id'));

		expect(withoutSessionId(trusted)).toEqual([
			'--mode',
			'rpc',
			'--model',
			'openai/gpt-test',
			'--thinking',
			'high',
		]);
		expect(withoutSessionId(readOnly)).toEqual(withoutSessionId(trusted));
	});

	it('never grows a permission or plan-mode flag', async () => {
		const args = await openPiSessionArgs({
			mode: 'approval-required',
			planMode: true,
		});

		for (const flag of args.filter((arg) => arg.startsWith('--'))) {
			expect(['--mode', '--model', '--thinking', '--session-id']).toContain(
				flag,
			);
		}
	});
});

/**
 * Resumes a persisted Claude session through the full composition the main
 * process uses — `createAgentSessionService` down to the SDK — so a mode that
 * stops being forwarded anywhere between those two layers fails here.
 */
async function resumeClaudeSessionThroughService(
	mode: PermissionMode,
): Promise<Options> {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-perm-svc-'));
	const databaseService = createEnsemblrDatabaseService({
		databasePath: path.join(directory, 'perm-svc.db'),
	});
	databaseService.open();
	cleanups.push(() => {
		databaseService.close();
		rmSync(directory, { force: true, recursive: true });
	});
	const database = databaseService.getConnection()?.database;
	if (!database) {
		throw new Error('The test database did not open.');
	}
	database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-perm', 'perm', 'Perm', '/tmp/ensemblr/perm', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('${WORKSPACE_ID}', 'repo-perm', 'perm', 'Perm', '${WORKSPACE_CWD}');
`);
	const { session } = createAgentSession({
		database,
		input: {
			cwd: WORKSPACE_CWD,
			provider: 'claude',
			workspaceId: WORKSPACE_ID,
		},
	});

	const captured: Options[] = [];
	const service = createAgentSessionService({
		agentClient: createAgentClient({
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
		}),
		captureCheckpoint: async () => null,
		databaseService,
		queueNaming: () => undefined,
		resolvePermissionMode: () => mode,
	});
	cleanups.push(() => {
		void service.shutdown();
	});

	await service.openSession({
		executable: createReadyExecutable(),
		resumeSessionId: session.id,
		workspaceCwd: WORKSPACE_CWD,
		workspaceId: WORKSPACE_ID,
	});

	const [options] = captured;
	if (!options) {
		throw new Error('The Claude adapter never called query().');
	}
	return options;
}

describe('the whole composition: service to SDK', () => {
	it('carries a read-only workspace all the way into the query options', async () => {
		const options = await resumeClaudeSessionThroughService('read-only');

		expect(options.permissionMode).toBe('plan');
		expect(options.disallowedTools).toEqual([
			...MUTATING_TOOLS,
			...NATIVE_SUBAGENT_TOOLS,
		]);
		expect(options.allowDangerouslySkipPermissions).not.toBe(true);
	});

	it('still opens a workspace-trusted workspace with full control', async () => {
		const options =
			await resumeClaudeSessionThroughService('workspace-trusted');

		expect(options.permissionMode).toBe('bypassPermissions');
		expect(options.allowDangerouslySkipPermissions).toBe(true);
	});
});
