import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentControlOrigin } from '../../src/main/agent-control/index.ts';
import {
	createGuardrails,
	DEFAULT_GUARDRAIL_CONFIG,
} from '../../src/main/agent-control/index.ts';
import { openEnsemblrDatabase } from '../../src/main/storage/database.ts';

const originAt = (depth: AgentControlOrigin['depth']): AgentControlOrigin => ({
	token: 'tok',
	sessionId: 'sess',
	workspaceId: 'ws',
	workspaceCwd: '/ws',
	parentSessionId: null,
	rootSessionId: 'sess',
	depth,
	species: 'pi',
	delegation: 'ensemblr',
	concierge: false,
	retired: false,
});

describe('guardrails: depth', () => {
	it('defaults to two edges, 20 lifetime spawns, and 10 spawns per minute', () => {
		expect(DEFAULT_GUARDRAIL_CONFIG).toMatchObject({
			maxSpawnDepth: 2,
			maxSpawnsPerMinute: 10,
			maxSpawnsPerSession: 20,
		});
	});

	it('allows root and depth-1 spawns but denies depth 2 by default', () => {
		const guardrails = createGuardrails();
		expect(guardrails.reserveSpawn(originAt(0)).ok).toBe(true);
		expect(
			guardrails.reserveSpawn({
				...originAt(1),
				parentSessionId: 'root',
				rootSessionId: 'root',
				sessionId: 'child',
			}).ok,
		).toBe(true);
		const denied = guardrails.reserveSpawn(originAt(2));
		expect(denied.ok).toBe(false);
		if (!denied.ok) {
			expect(denied.code).toBe('denied-depth');
		}
	});

	it('fails closed when a delegation root cannot be verified', () => {
		const denied = createGuardrails().reserveSpawn({
			...originAt(1),
			rootSessionId: null,
		});
		expect(denied.ok).toBe(false);
		if (!denied.ok) {
			expect(denied.code).toBe('denied-depth');
		}
	});
});

describe('guardrails: shared root-tree quota', () => {
	it('shares the lifetime total between a root and its descendants', () => {
		const guardrails = createGuardrails({
			maxSpawnsPerSession: 2,
			maxSpawnsPerMinute: 100,
		});
		const root = originAt(0);
		const child = {
			...originAt(1),
			parentSessionId: root.sessionId,
			rootSessionId: root.sessionId,
			sessionId: 'child',
		};
		expect(guardrails.reserveSpawn(root).ok).toBe(true);
		expect(guardrails.reserveSpawn(child).ok).toBe(true);
		const denied = guardrails.reserveSpawn(root);
		expect(denied.ok).toBe(false);
		if (!denied.ok) {
			expect(denied.code).toBe('denied-quota');
		}
	});

	it('keeps the lifetime total across rate windows and session release', () => {
		let clock = 0;
		const guardrails = createGuardrails(
			{ maxSpawnsPerSession: 1, maxSpawnsPerMinute: 100 },
			() => clock,
		);
		const origin = originAt(0);
		expect(guardrails.reserveSpawn(origin).ok).toBe(true);
		clock += 61_000;
		guardrails.release(origin.sessionId);
		const denied = guardrails.reserveSpawn(origin);
		expect(denied.ok).toBe(false);
		if (!denied.ok) {
			expect(denied.code).toBe('denied-quota');
		}
	});

	it('refunds a failed reservation exactly once', () => {
		const guardrails = createGuardrails({ maxSpawnsPerSession: 1 });
		const reserved = guardrails.reserveSpawn(originAt(0));
		expect(reserved.ok).toBe(true);
		if (reserved.ok) {
			reserved.refund();
			reserved.refund();
		}
		expect(guardrails.reserveSpawn(originAt(0)).ok).toBe(true);
	});
});

describe('guardrails: durable root-tree quota', () => {
	it('persists lifetime reservations beyond the rolling window across database reopen', () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-guardrails-'));
		const databasePath = path.join(directory, 'guardrails.db');
		try {
			let connection = openEnsemblrDatabase({ databasePath });
			const first = createGuardrails(
				{ maxSpawnsPerMinute: 2, maxSpawnsPerSession: 2 },
				() => 1_000,
				() => connection.database,
			);
			expect(first.reserveSpawn(originAt(0)).ok).toBe(true);
			connection.database.close();

			connection = openEnsemblrDatabase({ databasePath });
			const reopened = createGuardrails(
				{ maxSpawnsPerMinute: 2, maxSpawnsPerSession: 2 },
				() => 62_001,
				() => connection.database,
			);
			expect(reopened.reserveSpawn(originAt(0)).ok).toBe(true);
			const denied = reopened.reserveSpawn(originAt(0));
			expect(denied.ok).toBe(false);
			if (!denied.ok) {
				expect(denied.code).toBe('denied-quota');
			}
			connection.database.close();
		} finally {
			rmSync(directory, { force: true, recursive: true });
		}
	});

	it('keeps the rolling rate window across service recreation', () => {
		const connection = openEnsemblrDatabase({ databasePath: ':memory:' });
		try {
			const first = createGuardrails(
				{ maxSpawnsPerMinute: 1, maxSpawnsPerSession: 100 },
				() => 1_000,
				() => connection.database,
			);
			expect(first.reserveSpawn(originAt(0)).ok).toBe(true);
			const recreated = createGuardrails(
				{ maxSpawnsPerMinute: 1, maxSpawnsPerSession: 100 },
				() => 1_001,
				() => connection.database,
			);
			const denied = recreated.reserveSpawn(originAt(0));
			expect(denied.ok).toBe(false);
			if (!denied.ok) {
				expect(denied.code).toBe('denied-rate');
			}
		} finally {
			connection.database.close();
		}
	});

	it('atomically reserves parallel capacity and refunds only the failed creation', async () => {
		const connection = openEnsemblrDatabase({ databasePath: ':memory:' });
		try {
			const guardrails = createGuardrails(
				{ maxSpawnsPerMinute: 100, maxSpawnsPerSession: 2 },
				() => 1_000,
				() => connection.database,
			);
			const reservations = await Promise.all(
				[0, 1, 2].map(async () => guardrails.reserveSpawn(originAt(0))),
			);
			expect(reservations.filter((reservation) => reservation.ok)).toHaveLength(
				2,
			);
			const accepted = reservations.find((reservation) => reservation.ok);
			if (accepted?.ok) {
				accepted.refund();
				accepted.refund();
			}
			expect(guardrails.reserveSpawn(originAt(0)).ok).toBe(true);
		} finally {
			connection.database.close();
		}
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
		expect(guardrails.reserveSpawn(origin).ok).toBe(true);
		expect(guardrails.reserveSpawn(origin).ok).toBe(true);
		const denied = guardrails.reserveSpawn(origin);
		expect(denied.ok).toBe(false);
		if (!denied.ok) {
			expect(denied.code).toBe('denied-rate');
		}
		clock += 61_000;
		expect(guardrails.reserveSpawn(origin).ok).toBe(true);
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

		guardrails.reserveSpawn(originAt(0));
		guardrails.reserveSpawn(originAt(0));

		expect(guardrails.evaluateConciergeMessage('sess').ok).toBe(true);
	});

	it('drops a session’s message counters when it ends', () => {
		const guardrails = createGuardrails({ maxConciergeMessagesPerSession: 1 });

		guardrails.recordConciergeMessage('sess');
		guardrails.release('sess');

		expect(guardrails.evaluateConciergeMessage('sess').ok).toBe(true);
	});
});
