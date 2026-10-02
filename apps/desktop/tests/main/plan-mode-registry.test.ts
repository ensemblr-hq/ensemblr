import { describe, expect, it } from 'vitest';

import { createPlanModeRegistry } from '../../src/main/plan-mode/plan-mode-registry.ts';

const SESSION = 'sess-1';

describe('plan-mode registry', () => {
	it('reports an unknown session as neither planning nor submitted', () => {
		const registry = createPlanModeRegistry();

		expect(registry.isActive(SESSION)).toBe(false);
		expect(registry.hasSubmittedPlan(SESSION)).toBe(false);
	});

	it('remembers a plan a planning session handed over', () => {
		const registry = createPlanModeRegistry();
		registry.setActive(SESSION, true);

		registry.markSubmitted(SESSION);

		expect(registry.hasSubmittedPlan(SESSION)).toBe(true);
	});

	it('keeps the flag through the plan-mode toggle every submit re-sends', () => {
		const registry = createPlanModeRegistry();
		registry.setActive(SESSION, true);
		registry.markSubmitted(SESSION);

		registry.setActive(SESSION, true);

		expect(registry.hasSubmittedPlan(SESSION)).toBe(true);
	});

	it('clears the flag when the user approves and Plan Mode goes off', () => {
		const registry = createPlanModeRegistry();
		registry.setActive(SESSION, true);
		registry.markSubmitted(SESSION);

		registry.setActive(SESSION, false);

		expect(registry.hasSubmittedPlan(SESSION)).toBe(false);
	});

	it('ignores a submission from a session that is not planning', () => {
		const registry = createPlanModeRegistry();

		registry.markSubmitted(SESSION);

		expect(registry.hasSubmittedPlan(SESSION)).toBe(false);
	});

	it('forgets both flags once the session ends', () => {
		const registry = createPlanModeRegistry();
		registry.setActive(SESSION, true);
		registry.markSubmitted(SESSION);

		registry.release(SESSION);

		expect(registry.isActive(SESSION)).toBe(false);
		expect(registry.hasSubmittedPlan(SESSION)).toBe(false);
	});
});
