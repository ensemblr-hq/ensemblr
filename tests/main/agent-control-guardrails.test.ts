import { describe, expect, it } from 'vitest';
import type { AgentControlOrigin } from '../../src/main/agent-control/index.ts';
import { createGuardrails } from '../../src/main/agent-control/index.ts';

const originAt = (depth: number): AgentControlOrigin => ({
	token: 'tok',
	sessionId: 'sess',
	workspaceId: 'ws',
	workspaceCwd: '/ws',
	parentSessionId: null,
	depth,
	species: 'pi',
	delegation: 'ensemblr',
	concierge: false,
	retired: false,
});

describe('guardrails: depth', () => {
	it('denies a spawn once depth reaches the limit', () => {
		const guardrails = createGuardrails({ maxSpawnDepth: 2 });
		expect(guardrails.evaluateSpawn(originAt(1)).ok).toBe(true);
		const denied = guardrails.evaluateSpawn(originAt(2));
		expect(denied.ok).toBe(false);
		if (!denied.ok) {
			expect(denied.code).toBe('denied-depth');
		}
	});

	it('by default lets only the root spawn: a sub-agent is denied', () => {
		const guardrails = createGuardrails();
		expect(guardrails.evaluateSpawn(originAt(0)).ok).toBe(true);
		const denied = guardrails.evaluateSpawn(originAt(1));
		expect(denied.ok).toBe(false);
		if (!denied.ok) {
			expect(denied.code).toBe('denied-depth');
		}
	});
});

describe('guardrails: quota', () => {
	it('denies once the per-session total is exhausted', () => {
		let clock = 1_000;
		const guardrails = createGuardrails(
			{ maxSpawnsPerSession: 3, maxSpawnsPerMinute: 100 },
			() => clock,
		);
		const origin = originAt(0);
		for (let i = 0; i < 3; i += 1) {
			expect(guardrails.evaluateSpawn(origin).ok).toBe(true);
			guardrails.recordSpawn(origin.sessionId);
			clock += 1;
		}
		const denied = guardrails.evaluateSpawn(origin);
		expect(denied.ok).toBe(false);
		if (!denied.ok) {
			expect(denied.code).toBe('denied-quota');
		}
	});

	it('keeps the lifetime total across rate-window boundaries', () => {
		let clock = 0;
		const guardrails = createGuardrails(
			{ maxSpawnsPerSession: 3, maxSpawnsPerMinute: 100 },
			() => clock,
		);
		const origin = originAt(0);
		for (let i = 0; i < 3; i += 1) {
			expect(guardrails.evaluateSpawn(origin).ok).toBe(true);
			guardrails.recordSpawn(origin.sessionId);
			clock += 61_000;
		}
		const denied = guardrails.evaluateSpawn(origin);
		expect(denied.ok).toBe(false);
		if (!denied.ok) {
			expect(denied.code).toBe('denied-quota');
		}
	});

	it('drops a released session so its counters reset', () => {
		let clock = 1_000;
		const guardrails = createGuardrails(
			{ maxSpawnsPerSession: 1, maxSpawnsPerMinute: 100 },
			() => clock,
		);
		const origin = originAt(0);
		guardrails.recordSpawn(origin.sessionId);
		expect(guardrails.evaluateSpawn(origin).ok).toBe(false);
		guardrails.release(origin.sessionId);
		clock += 1;
		expect(guardrails.evaluateSpawn(origin).ok).toBe(true);
	});
});

describe('guardrails: rate', () => {
	it('denies bursts but recovers after the window slides', () => {
		let clock = 0;
		const guardrails = createGuardrails(
			{ maxSpawnsPerMinute: 2, maxSpawnsPerSession: 100 },
			() => clock,
		);
		const origin = originAt(0);
		guardrails.recordSpawn(origin.sessionId);
		guardrails.recordSpawn(origin.sessionId);
		const denied = guardrails.evaluateSpawn(origin);
		expect(denied.ok).toBe(false);
		if (!denied.ok) {
			expect(denied.code).toBe('denied-rate');
		}
		clock += 61_000;
		expect(guardrails.evaluateSpawn(origin).ok).toBe(true);
	});
});

describe('guardrails: deadlock', () => {
	it('refuses a wait targeting an ancestor session', () => {
		const guardrails = createGuardrails();
		const denied = guardrails.evaluateWaitTarget('parent', [
			'parent',
			'grandparent',
		]);
		expect(denied.ok).toBe(false);
		if (!denied.ok) {
			expect(denied.code).toBe('denied-deadlock');
		}
		expect(guardrails.evaluateWaitTarget('sibling', ['parent']).ok).toBe(true);
	});
});

// The loop this bounds is Concierge → orchestrator → Concierge: each message can
// start a Concierge turn, and each of those can brief the orchestrator again.
// Nothing in that cycle ends on its own.
describe('guardrails: messaging the Concierge', () => {
	it('denies a message once the session has spent its lifetime allowance', () => {
		const guardrails = createGuardrails({
			maxConciergeMessagesPerSession: 2,
		});

		guardrails.recordConciergeMessage('sess');
		guardrails.recordConciergeMessage('sess');
		const result = guardrails.evaluateConciergeMessage('sess');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe('denied-quota');
		}
	});

	it('denies a burst inside the rolling minute and allows one after it', () => {
		let now = 0;
		const guardrails = createGuardrails(
			{ maxConciergeMessagesPerMinute: 2, maxConciergeMessagesPerSession: 99 },
			() => now,
		);

		guardrails.recordConciergeMessage('sess');
		guardrails.recordConciergeMessage('sess');
		const burst = guardrails.evaluateConciergeMessage('sess');
		now += 61_000;
		const later = guardrails.evaluateConciergeMessage('sess');

		expect(burst.ok).toBe(false);
		if (!burst.ok) {
			expect(burst.code).toBe('denied-rate');
		}
		expect(later.ok).toBe(true);
	});

	// The two budgets are separate: an orchestrator that fanned out sub-agents has
	// not thereby used up its right to tell the Concierge it is blocked.
	it('counts messages apart from spawns', () => {
		const guardrails = createGuardrails({ maxConciergeMessagesPerSession: 1 });

		guardrails.recordSpawn('sess');
		guardrails.recordSpawn('sess');

		expect(guardrails.evaluateConciergeMessage('sess').ok).toBe(true);
	});

	it('drops a session’s message counters when it ends', () => {
		const guardrails = createGuardrails({ maxConciergeMessagesPerSession: 1 });

		guardrails.recordConciergeMessage('sess');
		guardrails.release('sess');

		expect(guardrails.evaluateConciergeMessage('sess').ok).toBe(true);
	});
});
