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
