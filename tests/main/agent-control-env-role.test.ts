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

/**
 * Builds the integration with a real origin registry, so depth comes from actual
 * lineage rather than a stub that could agree with the code by construction.
 */
const setup = (options: { markedSubAgent?: readonly string[] } = {}) => {
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
		originRegistry: registry,
		resolveWorkspaceCwd: (workspaceId) =>
			workspaceId === WORKSPACE ? CWD : null,
		getServerUrl: () => 'http://127.0.0.1:1234',
		isSpawnedSubAgent: (piSessionId) => marked.has(piSessionId),
	});
	return { resolveAgentControlEnv };
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
			getServerUrl: () => 'http://127.0.0.1:1234',
		});
		const env = resolveAgentControlEnv({
			sessionId: 'root',
			workspaceId: WORKSPACE,
		});
		expect(env.ENSEMBLR_CONTROL_ROLE).toBe('orchestrator');
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
