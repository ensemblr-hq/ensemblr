import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type {
	Options,
	Query,
	SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { createOriginRegistry } from '../../src/main/agent-control/origin-registry.ts';
import { createAgentClient } from '../../src/main/agent-runtime/agent-client.ts';
import type { AgentSubscription } from '../../src/main/agent-runtime/agent-types.ts';
import { resolveAgentControlWiring } from '../../src/main/agent-runtime/session/agent-control-wiring.ts';
import { createSessionOpener } from '../../src/main/agent-runtime/session/session-open.ts';
import { createClaudeAgentAdapter } from '../../src/main/claude-agent/claude-agent-adapter.ts';
import { resolveDisallowedTools } from '../../src/main/claude-agent/claude-subagent-mode.ts';
import type { PiExecutableSnapshot } from '../../src/main/pi-runtime/pi-executable.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';
import {
	type SubagentMechanism,
	withheldControlOps,
} from '../../src/shared/agent-control.ts';
import { CONTEXT_USAGE } from './helpers/claude-context-usage.ts';

const WORKSPACE_ID = 'ws-subagent';
const WORKSPACE_CWD = '/tmp/ensemblr/subagent/ws';
const MUTATING_TOOLS = [
	'Bash',
	'BashOutput',
	'Edit',
	'KillShell',
	'NotebookEdit',
	'Write',
];
const NATIVE_SUBAGENT_TOOLS = ['Agent', 'Task'];

/** Every op the chat-tab spawn surface is made of. */
const SPAWN_OPS = [
	'spawnChatTab',
	'startConversation',
	'sendFollowUp',
	'waitForAgents',
	'listModels',
] as const;

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()?.();
	}
});

describe('resolveDisallowedTools: exactly one mechanism survives', () => {
	it('denies Claude’s own sub-agent tool under both its names in ensemblr mode', () => {
		expect(resolveDisallowedTools({ delegation: 'ensemblr' })).toEqual(
			NATIVE_SUBAGENT_TOOLS,
		);
	});

	it('denies nothing of its own in native mode', () => {
		expect(resolveDisallowedTools({ delegation: 'native' })).toBeUndefined();
	});

	it('merges onto the permission mode’s list rather than replacing it', () => {
		expect(
			resolveDisallowedTools({
				delegation: 'ensemblr',
				permissionDisallowedTools: MUTATING_TOOLS,
			}),
		).toEqual([...MUTATING_TOOLS, ...NATIVE_SUBAGENT_TOOLS]);
	});

	it('keeps a read-only session’s mutating tools denied in native mode too', () => {
		expect(
			resolveDisallowedTools({
				delegation: 'native',
				permissionDisallowedTools: MUTATING_TOOLS,
			}),
		).toEqual(MUTATING_TOOLS);
	});
});

describe('withheldControlOps: the other half of the same choice', () => {
	it('withholds the chat-tab spawn ops from a root delegating natively', () => {
		const withheld = withheldControlOps({
			architectureDiagram: true,
			delegation: 'native',
			hasChatTab: true,
			role: 'orchestrator',
		});

		for (const op of SPAWN_OPS) {
			expect(withheld.has(op)).toBe(true);
		}
	});

	it('leaves the reads and the tab ops alone, which act on the user’s own tabs', () => {
		const withheld = withheldControlOps({
			architectureDiagram: true,
			delegation: 'native',
			hasChatTab: true,
			role: 'orchestrator',
		});

		for (const op of [
			'closeTab',
			'getConversationStatus',
			'getLastMessage',
			'readConversation',
		] as const) {
			expect(withheld.has(op)).toBe(false);
		}
	});

	it('withholds none of them from a root delegating through chat tabs', () => {
		const withheld = withheldControlOps({
			architectureDiagram: true,
			delegation: 'ensemblr',
			hasChatTab: true,
			role: 'orchestrator',
		});

		for (const op of SPAWN_OPS) {
			expect(withheld.has(op)).toBe(false);
		}
	});

	it('withholds the Concierge-only ops from a workspace agent', () => {
		const withheld = withheldControlOps({
			architectureDiagram: true,
			delegation: 'ensemblr',
			hasChatTab: true,
			role: 'orchestrator',
		});

		// Not a denial the agent could recover from by phrasing the call
		// differently: it has a workspace, so navigating to another one, cutting a
		// new one, listing the projects it could be cut from, and searching a memory
		// index it does not have are all meaningless rather than merely forbidden.
		expect([...withheld].toSorted()).toEqual([
			'createWorkspace',
			'focusWorkspace',
			'listProjects',
			'recallMemory',
		]);
	});
});

describe('the origin registry pins the mechanism for the session’s life', () => {
	it('keeps the mechanism a session registered with after the setting changes', () => {
		let setting: SubagentMechanism = 'native';
		const registry = createOriginRegistry({ generateToken: () => 'tok' });

		const origin = registry.register({
			delegation: setting,
			sessionId: 'sess-1',
			species: 'claude',
			workspaceCwd: WORKSPACE_CWD,
			workspaceId: WORKSPACE_ID,
		});
		setting = 'ensemblr';

		expect(origin.delegation).toBe('native');
		expect(registry.resolveByToken('tok')?.delegation).toBe('native');
		expect(setting).toBe('ensemblr');
	});

	it('falls back to ensemblr for a caller that registered without one', () => {
		const registry = createOriginRegistry({ generateToken: () => 'tok' });

		const origin = registry.register({
			sessionId: 'sess-1',
			species: 'pi',
			workspaceCwd: WORKSPACE_CWD,
			workspaceId: WORKSPACE_ID,
		});

		expect(origin.delegation).toBe('ensemblr');
	});
});

function openTestDatabase(): DatabaseSync {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-subagent-'));
	const connection = openEnsemblrDatabase({
		databasePath: path.join(directory, 'subagent-test.db'),
	});
	cleanups.push(() => {
		connection.database.close();
		rmSync(directory, { force: true, recursive: true });
	});
	connection.database.exec(`
INSERT INTO repositories (id, slug, name, path, default_branch)
VALUES ('repo-subagent', 'subagent', 'Subagent', '/tmp/ensemblr/subagent', 'main');
INSERT INTO workspaces (id, repository_id, slug, name, path)
VALUES ('${WORKSPACE_ID}', 'repo-subagent', 'subagent', 'Subagent', '${WORKSPACE_CWD}');
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

// A completed query reads to the adapter as a shutdown, which would close the
// session before the assertions run.
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
 * Opens Claude sessions through the production opener and returns the `Options`
 * each one handed the SDK. The mechanism is read through a getter, so a test can
 * change it between opens exactly as a user changing the setting does.
 */
async function openClaudeSessions({
	mode,
	opens,
	parentSessionId,
}: {
	mode: () => SubagentMechanism;
	opens: number;
	parentSessionId?: string;
}): Promise<readonly Options[]> {
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
	const opener = createSessionOpener({
		activeSessions: new Map(),
		agentClient,
		eventSink: undefined,
		isPlanModeActive: () => false,
		isAfkModeActive: () => false,
		now: () => new Date('2026-08-07T00:00:00.000Z'),
		queueNaming: () => undefined,
		readArchitectureDiagramEnabled: () => true,
		readClaudeSubagentMode: mode,
		resolvePermissionMode: () => 'workspace-trusted',
		subscribeToRuntime: () => noSubscription,
	});

	for (let index = 0; index < opens; index += 1) {
		await opener.openSession({
			database,
			request: {
				executable: createReadyExecutable(),
				...(parentSessionId ? { parentSessionId } : {}),
				provider: 'claude',
				workspaceCwd: WORKSPACE_CWD,
				workspaceId: WORKSPACE_ID,
			},
		});
	}

	cleanups.push(() => {
		void agentClient.shutdown();
	});
	return captured;
}

describe('the whole composition: the setting reaches the SDK options', () => {
	it('denies the built-in sub-agent tool when the user picked chat tabs', async () => {
		const [options] = await openClaudeSessions({
			mode: () => 'ensemblr',
			opens: 1,
		});

		expect(options?.disallowedTools).toEqual(NATIVE_SUBAGENT_TOOLS);
	});

	it('leaves the built-in sub-agent tool alone when the user picked it', async () => {
		const [options] = await openClaudeSessions({
			mode: () => 'native',
			opens: 1,
		});

		expect(options?.disallowedTools).toBeUndefined();
	});

	it('applies a changed setting to the next session, leaving the open one alone', async () => {
		let mode: SubagentMechanism = 'ensemblr';
		const [first, second] = await openClaudeSessions({
			mode: () => {
				const current = mode;
				mode = 'native';
				return current;
			},
			opens: 2,
		});

		expect(first?.disallowedTools).toEqual(NATIVE_SUBAGENT_TOOLS);
		expect(second?.disallowedTools).toBeUndefined();
	});
});

describe('a spawned child never opens under the native mechanism', () => {
	// Nested delegation is blocked on every other axis — the spawn ops are denied
	// and the playbook says a child never fans out — so a child left holding its
	// runtime's own sub-agent tool would route an unbounded fan-out around the
	// depth cap. Reachable whenever the setting reads `native` at the moment the
	// child opens: the user flipping it mid-run, or a harness root, whose origin
	// defaults to `ensemblr` and so keeps the spawn ops.
	it('pins a Claude child to ensemblr however the setting is set', () => {
		const wiring = resolveAgentControlWiring({
			isSpawnedSubAgent: undefined,
			parentSessionId: 'sess-root',
			provider: 'claude',
			readArchitectureDiagramEnabled: () => true,
			readClaudeSubagentMode: () => 'native',
			resolveAgentControlEnv: undefined,
			resolveTurnPreamble: undefined,
			sessionId: 'sess-child',
			workspaceId: WORKSPACE_ID,
		});

		expect(wiring.delegation).toBe('ensemblr');
	});

	it('denies the child its runtime’s own sub-agent tool all the way to the SDK', async () => {
		const [options] = await openClaudeSessions({
			mode: () => 'native',
			opens: 1,
			parentSessionId: 'sess-root',
		});

		expect(options?.disallowedTools).toEqual(NATIVE_SUBAGENT_TOOLS);
	});

	// `parentSessionId` rides the open request and a resume carries none, so
	// lineage alone would let a child reopened after a restart read as a root and
	// pick up the user's `native` setting — the escape this whole block rules out.
	// The chat tab's marker is a column, so it is what still answers.
	it('pins a resumed child to ensemblr on its marker, with no lineage left', () => {
		const wiring = resolveAgentControlWiring({
			isSpawnedSubAgent: (sessionId) => sessionId === 'sess-child',
			parentSessionId: null,
			provider: 'claude',
			readArchitectureDiagramEnabled: () => true,
			readClaudeSubagentMode: () => 'native',
			resolveAgentControlEnv: undefined,
			resolveTurnPreamble: undefined,
			sessionId: 'sess-child',
			workspaceId: WORKSPACE_ID,
		});

		expect(wiring.delegation).toBe('ensemblr');
	});

	it('leaves an unmarked root on the setting, so the marker is not a blanket pin', () => {
		const wiring = resolveAgentControlWiring({
			isSpawnedSubAgent: () => false,
			parentSessionId: null,
			provider: 'claude',
			readArchitectureDiagramEnabled: () => true,
			readClaudeSubagentMode: () => 'native',
			resolveAgentControlEnv: undefined,
			resolveTurnPreamble: undefined,
			sessionId: 'sess-root',
			workspaceId: WORKSPACE_ID,
		});

		expect(wiring.delegation).toBe('native');
	});
});

describe('the setting never reaches a runtime with no sub-agent tool of its own', () => {
	it('pins a Pi session to ensemblr however the Claude setting is set', () => {
		const wiring = resolveAgentControlWiring({
			isSpawnedSubAgent: undefined,
			parentSessionId: null,
			provider: 'pi',
			readArchitectureDiagramEnabled: () => true,
			readClaudeSubagentMode: () => 'native',
			resolveAgentControlEnv: undefined,
			resolveTurnPreamble: undefined,
			sessionId: 'sess-pi',
			workspaceId: WORKSPACE_ID,
		});

		expect(wiring.delegation).toBe('ensemblr');
	});

	it('pins a Claude session to what the setting says', () => {
		const wiring = resolveAgentControlWiring({
			isSpawnedSubAgent: undefined,
			parentSessionId: null,
			provider: 'claude',
			readArchitectureDiagramEnabled: () => true,
			readClaudeSubagentMode: () => 'native',
			resolveAgentControlEnv: undefined,
			resolveTurnPreamble: undefined,
			sessionId: 'sess-claude',
			workspaceId: WORKSPACE_ID,
		});

		expect(wiring.delegation).toBe('native');
	});
});
