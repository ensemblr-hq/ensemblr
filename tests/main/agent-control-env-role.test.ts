import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
	BrowserWindow: { getFocusedWindow: () => null },
	dialog: { showMessageBox: vi.fn() },
}));

import {
	createAgentControlIntegration,
	createOriginRegistry,
} from '../../src/main/agent-control/index.ts';

const WORKSPACE = 'ws-1';
const CWD = '/tmp/ws-1';
const CONCIERGE_CWD = '/tmp/root/concierge';

/**
 * Builds the integration with a real origin registry, so depth comes from actual
 * lineage rather than a stub that could agree with the code by construction.
 */
const setup = (
	options: {
		conciergeCwd?: string | null;
		markedSubAgent?: readonly string[];
	} = {},
) => {
	const marked = new Set(options.markedSubAgent ?? []);
	let issued = 0;
	const registry = createOriginRegistry({
		generateToken: () => {
			issued += 1;
			return `tok-${issued}`;
		},
	});
	const { releaseWorkspaceHarnessOrigins, resolveAgentControlEnv } =
		createAgentControlIntegration({
			app: {
				isPackaged: false,
				getAppPath: () => process.cwd(),
				getPath: () => '/tmp/userData',
			} as never,
			originRegistry: registry,
			resolveConciergeCwd: () =>
				options.conciergeCwd === undefined
					? CONCIERGE_CWD
					: options.conciergeCwd,
			resolveWorkspaceCwd: (workspaceId) =>
				workspaceId === WORKSPACE ? CWD : null,
			getLanguage: () => 'en' as const,
			getServerUrl: () => 'http://127.0.0.1:1234',
			isSpawnedSubAgent: (agentSessionId) => marked.has(agentSessionId),
		});
	return { registry, releaseWorkspaceHarnessOrigins, resolveAgentControlEnv };
};

describe('agent-control env: the role handed to a spawned agent', () => {
	it('calls an unmarked root session an orchestrator', () => {
		const { resolveAgentControlEnv } = setup();
		const env = resolveAgentControlEnv({
			sessionId: 'root',
			workspaceId: WORKSPACE,
		});
		expect(env.ENSEMBLR_CONTROL_ROLE).toBe('orchestrator');
		expect(env.ENSEMBLR_CONTROL_URL).toBe('http://127.0.0.1:1234');
		expect(env.ENSEMBLR_CONTROL_TOKEN).toBeTruthy();
	});

	it('calls a session with a live parent a sub-agent', () => {
		const { resolveAgentControlEnv } = setup();
		resolveAgentControlEnv({ sessionId: 'root', workspaceId: WORKSPACE });
		const env = resolveAgentControlEnv({
			sessionId: 'child',
			workspaceId: WORKSPACE,
			parentSessionId: 'root',
		});
		expect(env.ENSEMBLR_CONTROL_ROLE).toBe('subagent');
	});

	// The regression this exists for: a resumed child re-registers with no parent,
	// so lineage reports depth 0 while its Plan Mode comes back from the renderer.
	it('calls a marked session a sub-agent even when lineage says depth 0', () => {
		const { resolveAgentControlEnv } = setup({ markedSubAgent: ['resumed'] });
		const env = resolveAgentControlEnv({
			sessionId: 'resumed',
			workspaceId: WORKSPACE,
		});
		expect(env.ENSEMBLR_CONTROL_ROLE).toBe('subagent');
	});

	it('leaves an unmarked sibling of a marked session an orchestrator', () => {
		const { resolveAgentControlEnv } = setup({ markedSubAgent: ['resumed'] });
		const env = resolveAgentControlEnv({
			sessionId: 'unrelated',
			workspaceId: WORKSPACE,
		});
		expect(env.ENSEMBLR_CONTROL_ROLE).toBe('orchestrator');
	});

	it('falls back to lineage when no marker reader is wired', () => {
		const registry = createOriginRegistry({ generateToken: () => 'tok' });
		const { resolveAgentControlEnv } = createAgentControlIntegration({
			app: {
				isPackaged: false,
				getAppPath: () => process.cwd(),
				getPath: () => '/tmp/userData',
			} as never,
			originRegistry: registry,
			resolveWorkspaceCwd: () => CWD,
			getLanguage: () => 'en' as const,
			getServerUrl: () => 'http://127.0.0.1:1234',
		});
		const env = resolveAgentControlEnv({
			sessionId: 'root',
			workspaceId: WORKSPACE,
		});
		expect(env.ENSEMBLR_CONTROL_ROLE).toBe('orchestrator');
	});
});

describe('agent-control env: the Concierge overlay', () => {
	it('registers the Concierge under its own home with no workspace', () => {
		const { registry, resolveAgentControlEnv } = setup();
		const env = resolveAgentControlEnv({
			concierge: true,
			sessionId: 'concierge-1',
			species: 'claude',
			workspaceId: '',
		});
		expect(env.ENSEMBLR_CONTROL_ROLE).toBe('concierge');
		expect(env.ENSEMBLR_CONTROL_URL).toBe('http://127.0.0.1:1234');
		const origin = registry.resolveByToken(
			env.ENSEMBLR_CONTROL_TOKEN as string,
		);
		expect(origin?.concierge).toBe(true);
		expect(origin?.workspaceCwd).toBe(CONCIERGE_CWD);
		expect(origin?.workspaceId).toBe('');
		expect(origin?.species).toBe('claude');
	});

	// A Concierge is never on the lineage axis, so a stray marker under its
	// session id must not demote it to a sub-agent playbook and tool list.
	it('outranks a sub-agent marker carrying its session id', () => {
		const { resolveAgentControlEnv } = setup({
			markedSubAgent: ['concierge-1'],
		});
		expect(
			resolveAgentControlEnv({
				concierge: true,
				sessionId: 'concierge-1',
				species: 'pi',
				workspaceId: '',
			}).ENSEMBLR_CONTROL_ROLE,
		).toBe('concierge');
	});

	// The Concierge is on no lineage axis, so what it opens is a peer rather than
	// a child of it: a root orchestrator with its own delegation budget. The other
	// half of the same contract — that the spawn writes no sub-agent marker, which
	// would outrank this — lives in `concierge-spawn-role.test.ts`.
	it('hands a conversation it opens the orchestrator role', () => {
		const { resolveAgentControlEnv } = setup();
		resolveAgentControlEnv({
			concierge: true,
			sessionId: 'concierge-1',
			species: 'pi',
			workspaceId: '',
		});
		expect(
			resolveAgentControlEnv({
				parentSessionId: 'concierge-1',
				sessionId: 'child',
				workspaceId: WORKSPACE,
			}).ENSEMBLR_CONTROL_ROLE,
		).toBe('orchestrator');
	});

	// The depth exemption stops at the Concierge's own child: that child is an
	// ordinary orchestrator, and what it delegates to is a sub-agent.
	it('does not exempt the grandchild an opened conversation spawns', () => {
		const { resolveAgentControlEnv } = setup();
		resolveAgentControlEnv({
			concierge: true,
			sessionId: 'concierge-1',
			species: 'pi',
			workspaceId: '',
		});
		resolveAgentControlEnv({
			parentSessionId: 'concierge-1',
			sessionId: 'child',
			workspaceId: WORKSPACE,
		});
		expect(
			resolveAgentControlEnv({
				parentSessionId: 'child',
				sessionId: 'grandchild',
				workspaceId: WORKSPACE,
			}).ENSEMBLR_CONTROL_ROLE,
		).toBe('subagent');
	});

	it('returns no overlay before the root directory is known', () => {
		const { resolveAgentControlEnv } = setup({ conciergeCwd: null });
		expect(
			resolveAgentControlEnv({
				concierge: true,
				sessionId: 'concierge-1',
				workspaceId: '',
			}),
		).toEqual({});
	});
});

describe('agent-control env: when there is nothing to hand out', () => {
	it('returns no overlay before the control server is listening', () => {
		const registry = createOriginRegistry({ generateToken: () => 'tok' });
		const { resolveAgentControlEnv } = createAgentControlIntegration({
			app: {
				isPackaged: false,
				getAppPath: () => process.cwd(),
				getPath: () => '/tmp/userData',
			} as never,
			originRegistry: registry,
			resolveWorkspaceCwd: () => CWD,
			getLanguage: () => 'en' as const,
			getServerUrl: () => null,
		});
		expect(
			resolveAgentControlEnv({ sessionId: 's', workspaceId: WORKSPACE }),
		).toEqual({});
	});

	it('returns no overlay for a workspace with no resolvable checkout', () => {
		const { resolveAgentControlEnv } = setup();
		expect(
			resolveAgentControlEnv({ sessionId: 's', workspaceId: 'missing' }),
		).toEqual({});
	});
});

// The harness origin is shared by every terminal in a workspace under the
// synthetic session id `ws:<workspaceId>`, and that id is also the root of its
// own lineage — so the durable 20-spawn ledger counted against a key that never
// changes. Twenty file tabs over as many weeks exhausted a workspace's whole
// terminal budget, permanently and across restarts.
describe('agent-control env: the harness origin is scoped to one app run', () => {
	it('roots a harness origin at a session id this run alone can produce', () => {
		const { registry, resolveAgentControlEnv } = setup();
		const env = resolveAgentControlEnv({
			sessionId: `ws:${WORKSPACE}`,
			workspaceId: WORKSPACE,
			species: 'harness',
		});
		const origin = registry.resolveByToken(env.ENSEMBLR_CONTROL_TOKEN ?? '');

		expect(origin?.sessionId).toMatch(new RegExp(`^ws:${WORKSPACE}:.+`));
		expect(origin?.sessionId).not.toBe(`ws:${WORKSPACE}`);
		expect(origin?.rootSessionId).toBe(origin?.sessionId);
		expect(origin?.workspaceId).toBe(WORKSPACE);
		expect(origin?.depth).toBe(0);
	});

	it('hands every terminal in one run the same origin', () => {
		const { resolveAgentControlEnv } = setup();
		const first = resolveAgentControlEnv({
			sessionId: `ws:${WORKSPACE}`,
			workspaceId: WORKSPACE,
			species: 'harness',
		});
		const second = resolveAgentControlEnv({
			sessionId: `ws:${WORKSPACE}`,
			workspaceId: WORKSPACE,
			species: 'harness',
		});

		expect(second.ENSEMBLR_CONTROL_TOKEN).toBe(first.ENSEMBLR_CONTROL_TOKEN);
	});

	it('gives the next run a root of its own', () => {
		const previousRun = setup().resolveAgentControlEnv({
			sessionId: `ws:${WORKSPACE}`,
			workspaceId: WORKSPACE,
			species: 'harness',
		});
		const { registry, resolveAgentControlEnv } = setup();
		const thisRun = resolveAgentControlEnv({
			sessionId: `ws:${WORKSPACE}`,
			workspaceId: WORKSPACE,
			species: 'harness',
		});

		expect(
			registry.resolveByToken(thisRun.ENSEMBLR_CONTROL_TOKEN ?? '')?.sessionId,
		).not.toBe(previousRun.ENSEMBLR_CONTROL_TOKEN);
	});

	it('leaves a conversation session id alone', () => {
		const { registry, resolveAgentControlEnv } = setup();
		const env = resolveAgentControlEnv({
			sessionId: 'root',
			workspaceId: WORKSPACE,
		});

		expect(
			registry.resolveByToken(env.ENSEMBLR_CONTROL_TOKEN ?? '')?.sessionId,
		).toBe('root');
	});
});

// Nothing calls `releaseSession` for the workspace harness origin, so the token
// minted for the first terminal in a workspace stayed valid for the app's whole
// life — along with the worktree path captured with it, whether or not the
// workspace still exists.
describe('agent-control env: releasing a workspace’s harness origin', () => {
	it('invalidates the harness token and leaves conversations alone', () => {
		const { registry, releaseWorkspaceHarnessOrigins, resolveAgentControlEnv } =
			setup();
		const harness = resolveAgentControlEnv({
			sessionId: `ws:${WORKSPACE}`,
			workspaceId: WORKSPACE,
			species: 'harness',
		});
		const conversation = resolveAgentControlEnv({
			sessionId: 'root',
			workspaceId: WORKSPACE,
		});

		releaseWorkspaceHarnessOrigins(WORKSPACE);

		expect(
			registry.resolveByToken(harness.ENSEMBLR_CONTROL_TOKEN ?? ''),
		).toBeNull();
		expect(
			registry.resolveByToken(conversation.ENSEMBLR_CONTROL_TOKEN ?? ''),
		).not.toBeNull();
	});

	it('is a no-op for a workspace with no harness origin', () => {
		const { releaseWorkspaceHarnessOrigins } = setup();
		expect(() => releaseWorkspaceHarnessOrigins('missing')).not.toThrow();
	});
});
