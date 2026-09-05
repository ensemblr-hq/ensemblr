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

	// A retired Concierge child still has to reach the control server to have its
	// memory writes cleared, so retirement flags the origin rather than dropping
	// it — the token keeps resolving, to a narrower identity.
	it('retires a session without invalidating its token', () => {
		const registry = makeRegistry();
		const origin = registry.register({
			sessionId: 's1',
			workspaceId: '',
			concierge: true,
			workspaceCwd: '/home',
			species: 'pi',
		});
		expect(origin.retired).toBe(false);

		registry.retire('s1');

		expect(registry.resolveByToken(origin.token)?.retired).toBe(true);
		expect(registry.resolveBySession('s1')?.retired).toBe(true);
	});

	it('ignores a retire for a session it does not hold', () => {
		const registry = makeRegistry();
		expect(() => registry.retire('never-registered')).not.toThrow();
		expect(registry.resolveBySession('never-registered')).toBeNull();
	});

	// Read back through the registry rather than off the handle the caller kept:
	// retiring replaces the record instead of mutating it, so a request already
	// admitted keeps the identity it was gated on.
	it('leaves the origin a caller already holds untouched', () => {
		const registry = makeRegistry();
		const origin = registry.register({
			sessionId: 's1',
			workspaceId: '',
			concierge: true,
			workspaceCwd: '/home',
			species: 'pi',
		});

		registry.retire('s1');

		expect(origin.retired).toBe(false);
	});
});

// The peer cap counts concurrent writers on a workspace's one checkout, so it
// asks the registry who is registered there — not the Concierge, which belongs
// to no workspace and writes to none. Classifying what comes back is the
// service's job, so this hands over whole origins rather than ids.
describe('origin registry: who is registered in a workspace', () => {
	it('lists the origins registered against that workspace only', () => {
		const registry = createOriginRegistry();
		registry.register({
			sessionId: 'a',
			species: 'pi',
			workspaceCwd: '/a',
			workspaceId: 'ws-a',
		});
		registry.register({
			sessionId: 'b',
			species: 'pi',
			workspaceCwd: '/a',
			workspaceId: 'ws-a',
		});
		registry.register({
			sessionId: 'c',
			species: 'pi',
			workspaceCwd: '/b',
			workspaceId: 'ws-b',
		});

		expect(
			registry
				.originsInWorkspace('ws-a')
				.map((origin) => origin.sessionId)
				.sort(),
		).toEqual(['a', 'b']);
		expect(
			registry.originsInWorkspace('ws-b').map((origin) => origin.sessionId),
		).toEqual(['c']);
	});

	// The workspace-scoped origin a terminal launch mints carries `harness`, and
	// telling it apart from a conversation is what the species is for — so it has
	// to survive the trip rather than be flattened to an id here.
	it('carries the species through, so a caller can tell a terminal apart', () => {
		const registry = createOriginRegistry();
		registry.register({
			sessionId: 'ws:ws-a',
			species: 'harness',
			workspaceCwd: '/a',
			workspaceId: 'ws-a',
		});

		expect(
			registry.originsInWorkspace('ws-a').map((origin) => origin.species),
		).toEqual(['harness']);
	});

	it('leaves out the Concierge, which belongs to no workspace', () => {
		const registry = createOriginRegistry();
		registry.register({
			concierge: true,
			sessionId: 'concierge',
			species: 'pi',
			workspaceCwd: '/home',
			workspaceId: '',
		});

		expect(registry.originsInWorkspace('')).toEqual([]);
	});

	it('drops a session as soon as it is released', () => {
		const registry = createOriginRegistry();
		registry.register({
			sessionId: 'a',
			species: 'pi',
			workspaceCwd: '/a',
			workspaceId: 'ws-a',
		});
		registry.release('a');

		expect(registry.originsInWorkspace('ws-a')).toEqual([]);
	});
});
