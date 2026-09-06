import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	BrowserWindow: { getFocusedWindow: () => null },
	dialog: { showMessageBox: vi.fn() },
}));

import {
	CONTROL_TOKEN_ENV_KEY,
	createAgentControlIntegration,
	createOriginRegistry,
	MCP_TOOL_CALL_TIMEOUT_MS,
} from '../../src/main/agent-control/index.ts';
import { resolveAgentControlWiring } from '../../src/main/agent-runtime/session/agent-control-wiring.ts';
import { buildClaudeMcpServers } from '../../src/main/claude-agent/claude-mcp-config.ts';
import {
	harnessAwareness,
	orchestratorAwareness,
	subagentAwareness,
} from '../../src/shared/agent-control.ts';

/** Each playbook with the architecture diagram on, as these tests wire it. */
const HARNESS_AWARENESS = harnessAwareness({
	architectureDiagram: true,
	tuiHarnesses: true,
});
const ORCHESTRATOR_AWARENESS = orchestratorAwareness({
	architectureDiagram: true,
	tuiHarnesses: true,
});
const SUBAGENT_AWARENESS = subagentAwareness({
	architectureDiagram: true,
	tuiHarnesses: true,
});

const WORKSPACE = 'ws-1';
const CWD = '/tmp/ws-1';
const SERVER_URL = 'http://127.0.0.1:4321';

/**
 * Wires the real integration and origin registry, so the species a session
 * registers under is read back off the registry the control server resolves
 * against rather than off a stub that could agree with the code by construction.
 */
const setup = (
	options: { markedSubAgent?: readonly string[]; serverUp?: boolean } = {},
) => {
	const marked = new Set(options.markedSubAgent ?? []);
	let issued = 0;
	const registry = createOriginRegistry({
		generateToken: () => {
			issued += 1;
			return `tok-${issued}`;
		},
	});
	const { resolveAgentControlEnv } = createAgentControlIntegration({
		app: {
			isPackaged: false,
			getAppPath: () => process.cwd(),
			getPath: () => '/tmp/userData',
		} as never,
		getLanguage: () => 'en' as const,
		getServerUrl: () => (options.serverUp === false ? null : SERVER_URL),
		isSpawnedSubAgent: (sessionId) => marked.has(sessionId),
		originRegistry: registry,
		resolveWorkspaceCwd: (workspaceId) =>
			workspaceId === WORKSPACE ? CWD : null,
	});

	const wire = (input: {
		parentSessionId?: string | null;
		provider: 'claude' | 'pi';
		sessionId: string;
	}) =>
		resolveAgentControlWiring({
			isSpawnedSubAgent: (sessionId) => marked.has(sessionId),
			parentSessionId: input.parentSessionId ?? null,
			provider: input.provider,
			readArchitectureDiagramEnabled: () => true,
			readTuiHarnessesEnabled: () => true,
			readClaudeSubagentMode: undefined,
			resolveAgentControlEnv,
			resolveTurnPreamble: undefined,
			sessionId: input.sessionId,
			workspaceId: WORKSPACE,
		});

	return { registry, wire };
};

describe('agent-control wiring: the species a session registers under', () => {
	it('registers a Claude session as its own species, not as Pi', () => {
		const { registry, wire } = setup();

		wire({ provider: 'claude', sessionId: 'claude-1' });

		expect(registry.resolveBySession('claude-1')?.species).toBe('claude');
	});

	it('registers a Pi session as Pi', () => {
		const { registry, wire } = setup();

		wire({ provider: 'pi', sessionId: 'pi-1' });

		expect(registry.resolveBySession('pi-1')?.species).toBe('pi');
	});

	it('never registers a first-class chat as a harness', () => {
		const { registry, wire } = setup();

		wire({ provider: 'claude', sessionId: 'claude-1' });
		wire({ provider: 'pi', sessionId: 'pi-1' });

		for (const sessionId of ['claude-1', 'pi-1']) {
			expect(registry.resolveBySession(sessionId)?.species).not.toBe('harness');
		}
	});

	it('keeps the spawning session on the request so lineage still resolves', () => {
		const { registry, wire } = setup();

		wire({ provider: 'claude', sessionId: 'root' });
		wire({ parentSessionId: 'root', provider: 'claude', sessionId: 'child' });

		expect(registry.resolveBySession('child')?.depth).toBe(1);
		expect(registry.resolveBySession('child')?.parentSessionId).toBe('root');
	});
});

describe('agent-control wiring: the control MCP endpoint', () => {
	it('hands Claude the loopback endpoint and its own bearer token', () => {
		const { registry, wire } = setup();

		const wiring = wire({ provider: 'claude', sessionId: 'claude-1' });

		expect(wiring.controlMcp).toEqual({
			token: registry.resolveBySession('claude-1')?.token,
			url: SERVER_URL,
		});
	});

	it('leaves Pi without one, because its extension is its MCP client', () => {
		const { wire } = setup();

		const wiring = wire({ provider: 'pi', sessionId: 'pi-1' });

		expect(wiring.controlMcp).toBeNull();
		expect(wiring.systemPromptAppend).toBeNull();
	});

	it('still hands every runtime the env overlay', () => {
		const { registry, wire } = setup();

		const claude = wire({ provider: 'claude', sessionId: 'claude-1' });
		const pi = wire({ provider: 'pi', sessionId: 'pi-1' });

		expect(claude.env?.ENSEMBLR_CONTROL_TOKEN).toBe(
			registry.resolveBySession('claude-1')?.token,
		);
		expect(pi.env?.ENSEMBLR_CONTROL_TOKEN).toBe(
			registry.resolveBySession('pi-1')?.token,
		);
	});

	it('withholds the endpoint and the playbook when the server is down', () => {
		const { wire } = setup({ serverUp: false });

		const wiring = wire({ provider: 'claude', sessionId: 'claude-1' });

		expect(wiring.controlMcp).toBeNull();
		expect(wiring.systemPromptAppend).toBeNull();
		expect(wiring.env).toEqual({});
	});

	it('resolves to nothing at all when the control layer is disabled', () => {
		const wiring = resolveAgentControlWiring({
			isSpawnedSubAgent: undefined,
			parentSessionId: null,
			provider: 'claude',
			readArchitectureDiagramEnabled: () => true,
			readTuiHarnessesEnabled: () => true,
			readClaudeSubagentMode: undefined,
			resolveAgentControlEnv: undefined,
			resolveTurnPreamble: undefined,
			sessionId: 'claude-1',
			workspaceId: WORKSPACE,
		});

		expect(wiring).toEqual({
			controlMcp: null,
			delegation: 'ensemblr',
			env: undefined,
			resolveTurnPreamble: null,
			systemPromptAppend: null,
		});
	});
});

// Pi's extension pulls the upkeep block itself before every turn. A runtime the
// app drives over MCP has its system prompt fixed at open, so without a per-turn
// hand-off it is never told what naming the session still owes — which is how
// Claude sessions went their whole life without naming a branch.
describe('agent-control wiring: the per-turn upkeep block', () => {
	const setupWithNudge = () => {
		const registry = createOriginRegistry();
		const { resolveAgentControlEnv } = createAgentControlIntegration({
			app: {
				isPackaged: false,
				getAppPath: () => process.cwd(),
				getPath: () => '/tmp/userData',
			} as never,
			getLanguage: () => 'en' as const,
			getServerUrl: () => SERVER_URL,
			originRegistry: registry,
			resolveWorkspaceCwd: () => CWD,
		});
		const asked: string[] = [];
		return {
			asked,
			wire: (provider: 'claude' | 'pi', sessionId: string) =>
				resolveAgentControlWiring({
					isSpawnedSubAgent: undefined,
					parentSessionId: null,
					provider,
					readArchitectureDiagramEnabled: () => true,
					readTuiHarnessesEnabled: () => true,
					readClaudeSubagentMode: undefined,
					resolveAgentControlEnv,
					resolveTurnPreamble: async (id) => {
						asked.push(id);
						return 'UPKEEP';
					},
					sessionId,
					workspaceId: WORKSPACE,
				}),
		};
	};

	it('hands Claude a resolver bound to its own session', async () => {
		const { asked, wire } = setupWithNudge();

		const wiring = wire('claude', 'claude-1');

		expect(await wiring.resolveTurnPreamble?.()).toBe('UPKEEP');
		expect(asked).toEqual(['claude-1']);
	});

	it('withholds it from Pi, whose extension fetches the block itself', () => {
		const { wire } = setupWithNudge();

		expect(wire('pi', 'pi-1').resolveTurnPreamble).toBeNull();
	});
});

describe('agent-control wiring: the playbook appended to Claude', () => {
	it('gives a root chat the orchestrator playbook', () => {
		const { wire } = setup();

		const wiring = wire({ provider: 'claude', sessionId: 'root' });

		expect(wiring.systemPromptAppend).toBe(ORCHESTRATOR_AWARENESS);
	});

	it('gives a spawned child the sub-agent playbook', () => {
		const { wire } = setup();

		wire({ provider: 'claude', sessionId: 'root' });
		const wiring = wire({
			parentSessionId: 'root',
			provider: 'claude',
			sessionId: 'child',
		});

		expect(wiring.systemPromptAppend).toBe(SUBAGENT_AWARENESS);
	});

	it('honours the durable sub-agent marker for a resumed child at depth 0', () => {
		const { wire } = setup({ markedSubAgent: ['restored'] });

		const wiring = wire({ provider: 'claude', sessionId: 'restored' });

		expect(wiring.systemPromptAppend).toBe(SUBAGENT_AWARENESS);
	});

	it('never gives first-class Claude the harness playbook', () => {
		const { wire } = setup();

		wire({ provider: 'claude', sessionId: 'root' });
		const child = wire({
			parentSessionId: 'root',
			provider: 'claude',
			sessionId: 'child',
		});
		const root = wire({ provider: 'claude', sessionId: 'root' });

		expect(child.systemPromptAppend).not.toBe(HARNESS_AWARENESS);
		expect(root.systemPromptAppend).not.toBe(HARNESS_AWARENESS);
	});

	it('keeps the control token out of the MCP config the SDK puts on argv', () => {
		const { wire } = setup();

		const wiring = wire({ provider: 'claude', sessionId: 'root' });
		const token = wiring.controlMcp?.token;
		const servers = buildClaudeMcpServers(wiring.controlMcp);

		expect(token).toBeTruthy();
		expect(JSON.stringify(servers)).not.toContain(token);
		expect(servers.ensemblr).toMatchObject({
			headers: { Authorization: `Bearer \${${CONTROL_TOKEN_ENV_KEY}}` },
		});
	});

	// Claude's per-call timeout is a hard wall-clock limit that progress
	// notifications do not extend, so raising it here is the only thing keeping
	// `ensemblr_ask_user_question` open while the user is away.
	it('raises the tool-call timeout past its MCP_TOOL_TIMEOUT default', () => {
		const { wire } = setup();

		const servers = buildClaudeMcpServers(
			wire({ provider: 'claude', sessionId: 'root' }).controlMcp,
		);

		expect(servers.ensemblr).toMatchObject({
			timeout: MCP_TOOL_CALL_TIMEOUT_MS,
		});
		expect(MCP_TOOL_CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(3_600_000);
	});

	it('passes the token to the child through the env the reference resolves against', () => {
		const { wire } = setup();

		const wiring = wire({ provider: 'claude', sessionId: 'root' });

		expect(wiring.env?.[CONTROL_TOKEN_ENV_KEY]).toBe(wiring.controlMcp?.token);
	});
});
