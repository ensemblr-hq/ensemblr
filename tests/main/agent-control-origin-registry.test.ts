import { describe, expect, it } from 'vitest';

import { createOriginRegistry } from '../../src/main/agent-control/index.ts';

const makeRegistry = () => {
	let counter = 0;
	return createOriginRegistry({
		generateToken: () => {
			counter += 1;
			return `tok-${counter}`;
		},
	});
};

describe('origin registry', () => {
	it('mints a token and roots depth at zero', () => {
		const registry = makeRegistry();
		const origin = registry.register({
			sessionId: 's1',
			workspaceId: 'ws1',
			workspaceCwd: '/ws1',
			species: 'pi',
		});
		expect(origin.token).toBe('tok-1');
		expect(origin.depth).toBe(0);
		expect(registry.resolveByToken('tok-1')).toEqual(origin);
		expect(registry.resolveBySession('s1')).toEqual(origin);
	});

	it('derives child depth from the parent', () => {
		const registry = makeRegistry();
		registry.register({
			sessionId: 'parent',
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			species: 'pi',
		});
		const child = registry.register({
			sessionId: 'child',
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			species: 'harness',
			parentSessionId: 'parent',
		});
		expect(child.depth).toBe(1);
	});

	it('is idempotent per session', () => {
		const registry = makeRegistry();
		const first = registry.register({
			sessionId: 's1',
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			species: 'pi',
		});
		const second = registry.register({
			sessionId: 's1',
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			species: 'pi',
		});
		expect(second).toBe(first);
	});

	it('walks the ancestor chain and stops on cycles', () => {
		const registry = makeRegistry();
		registry.register({
			sessionId: 'a',
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			species: 'pi',
		});
		registry.register({
			sessionId: 'b',
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			species: 'pi',
			parentSessionId: 'a',
		});
		registry.register({
			sessionId: 'c',
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			species: 'pi',
			parentSessionId: 'b',
		});
		expect(registry.ancestorsOf('c')).toEqual(['b', 'a']);
	});

	it('releases a session and forgets its token', () => {
		const registry = makeRegistry();
		const origin = registry.register({
			sessionId: 's1',
			workspaceId: 'ws',
			workspaceCwd: '/ws',
			species: 'pi',
		});
		registry.release('s1');
		expect(registry.resolveByToken(origin.token)).toBeNull();
		expect(registry.resolveBySession('s1')).toBeNull();
	});
});
