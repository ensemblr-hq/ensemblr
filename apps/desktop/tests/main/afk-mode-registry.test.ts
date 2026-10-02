import { describe, expect, it } from 'vitest';

import { createAfkModeRegistry } from '../../src/main/afk-mode/afk-mode-registry.ts';

const SESSION = 'sess-1';

describe('afk-mode registry', () => {
	it('reports an unknown session as attended', () => {
		const registry = createAfkModeRegistry();

		expect(registry.isActive(SESSION)).toBe(false);
	});

	it('remembers a session the user stepped away from', () => {
		const registry = createAfkModeRegistry();

		registry.setActive(SESSION, true);

		expect(registry.isActive(SESSION)).toBe(true);
	});

	it('clears the session when the user comes back', () => {
		const registry = createAfkModeRegistry();
		registry.setActive(SESSION, true);

		registry.setActive(SESSION, false);

		expect(registry.isActive(SESSION)).toBe(false);
	});

	it('marks a spawned child unattended without touching its parent', () => {
		const registry = createAfkModeRegistry();
		registry.setActive('parent', true);

		registry.activateForSpawn('child');

		expect(registry.isActive('child')).toBe(true);
		expect(registry.isActive('parent')).toBe(true);
	});

	it('forgets a session that ended, and tolerates a second release', () => {
		const registry = createAfkModeRegistry();
		registry.setActive(SESSION, true);

		registry.release(SESSION);
		registry.release(SESSION);

		expect(registry.isActive(SESSION)).toBe(false);
	});

	it('keeps sessions independent of one another', () => {
		const registry = createAfkModeRegistry();
		registry.setActive('a', true);

		registry.setActive('b', false);

		expect(registry.isActive('a')).toBe(true);
		expect(registry.isActive('b')).toBe(false);
	});
});
