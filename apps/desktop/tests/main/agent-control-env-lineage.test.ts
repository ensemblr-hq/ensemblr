import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from 'electron';
import { CONTROL_DEPTH_ENV_KEY } from '../../src/main/agent-control/control-env-keys.ts';
import { createAgentControlIntegration } from '../../src/main/agent-control/main-integration.ts';
import { createOriginRegistry } from '../../src/main/agent-control/origin-registry.ts';

test.after(() => app.quit());

test('control env registers persisted lineage with a cold origin registry', () => {
	const registry = createOriginRegistry({ generateToken: () => 'token' });
	const { resolveAgentControlEnv } = createAgentControlIntegration({
		app: {
			getAppPath: () => process.cwd(),
			getPath: () => '/tmp',
			isPackaged: false,
		} as never,
		getLanguage: () => 'en',
		getServerUrl: () => 'http://127.0.0.1:1234',
		originRegistry: registry,
		resolveSessionLineage: () => ({
			depth: 2,
			parentSessionId: 'child',
			rootSessionId: 'root',
		}),
		resolveWorkspaceCwd: () => '/tmp/ws',
	});

	const env = resolveAgentControlEnv({
		sessionId: 'leaf',
		species: 'pi',
		workspaceId: 'ws',
	});

	assert.equal(env[CONTROL_DEPTH_ENV_KEY], '2');
	assert.equal(env.ENSEMBLR_CONTROL_ROLE, 'subagent');
	assert.deepEqual(
		{
			depth: registry.resolveBySession('leaf')?.depth,
			parentSessionId: registry.resolveBySession('leaf')?.parentSessionId,
			rootSessionId: registry.resolveBySession('leaf')?.rootSessionId,
		},
		{ depth: 2, parentSessionId: 'child', rootSessionId: 'root' },
	);
});
