import assert from 'node:assert/strict';
import test from 'node:test';
import { createOriginRegistry } from '../../src/main/agent-control/origin-registry.ts';

test('origin registry keeps authoritative durable lineage after live parents disappear', () => {
	const registry = createOriginRegistry({ generateToken: () => 'token' });
	const child = registry.register({
		lineage: {
			depth: 1,
			parentSessionId: 'root',
			rootSessionId: 'root',
		},
		sessionId: 'child',
		species: 'pi',
		workspaceCwd: '/ws',
		workspaceId: 'ws',
	});

	assert.equal(child.depth, 1);
	assert.equal(child.parentSessionId, 'root');
	assert.equal(child.rootSessionId, 'root');
});

test('origin registry fails a descendant closed when its live parent is missing', () => {
	const registry = createOriginRegistry({ generateToken: () => 'token' });
	const child = registry.register({
		parentSessionId: 'missing',
		sessionId: 'child',
		species: 'pi',
		workspaceCwd: '/ws',
		workspaceId: 'ws',
	});

	assert.equal(child.depth, 2);
	assert.equal(child.parentSessionId, 'missing');
	assert.equal(child.rootSessionId, null);
});
