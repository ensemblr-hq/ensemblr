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

describe('guardrails: terminal starts', () => {
	it('defaults to eight open terminals and ten starts per minute', () => {
		expect(DEFAULT_GUARDRAIL_CONFIG).toMatchObject({
			maxOpenTerminals: 8,
			maxTerminalStartsPerMinute: 10,
		});
	});

	// The bug this replaced: every terminal an agent had ever opened went on
	// costing it a slot, so a long session ran out of budget to delegate with.
	// Only what is open now is counted, and opening costs the spawn ledger
	// nothing at all.
	it('spends no lifetime spawn quota', () => {
		const guardrails = createGuardrails({ maxSpawnsPerSession: 1 });

		for (let start = 0; start < 5; start += 1) {
			expect(guardrails.reserveTerminalStart(originAt(0), 0).ok).toBe(true);
		}

		expect(guardrails.reserveSpawn(originAt(0)).ok).toBe(true);
	});

	it('refuses a start once the tree holds its limit of open terminals', () => {
		const guardrails = createGuardrails({ maxOpenTerminals: 2 });

		expect(guardrails.reserveTerminalStart(originAt(0), 1).ok).toBe(true);
		const denied = guardrails.reserveTerminalStart(originAt(0), 2);

		expect(denied.ok).toBe(false);
		if (!denied.ok) {
			expect(denied.code).toBe('denied-quota');
			expect(denied.reason).toContain('Only what is still open counts');
		}
	});

	// A closed terminal leaves the caller's open count, and that is all it takes
	// for the next start to be allowed — nothing refunds anything.
	it('allows the next start as soon as the open count falls', () => {
		const guardrails = createGuardrails({ maxOpenTerminals: 2 });

		expect(guardrails.reserveTerminalStart(originAt(0), 2).ok).toBe(false);
		expect(guardrails.reserveTerminalStart(originAt(0), 1).ok).toBe(true);
	});

	it('rate-limits a burst of starts and recovers after the window', () => {
		let now = 0;
		const guardrails = createGuardrails(
			{ maxTerminalStartsPerMinute: 2 },
			() => now,
		);

		guardrails.reserveTerminalStart(originAt(0), 0);
		guardrails.reserveTerminalStart(originAt(0), 0);
		const burst = guardrails.reserveTerminalStart(originAt(0), 0);
		now += 61_000;
		const later = guardrails.reserveTerminalStart(originAt(0), 0);

		expect(burst.ok).toBe(false);
		if (!burst.ok) {
			expect(burst.code).toBe('denied-rate');
		}
		expect(later.ok).toBe(true);
	});

	// A start that never produced a terminal must not sit inside the rate window
	// holding the caller back from retrying.
	it('returns rate capacity when the start fails', () => {
		const guardrails = createGuardrails({ maxTerminalStartsPerMinute: 1 });

		const reserved = guardrails.reserveTerminalStart(originAt(0), 0);
		if (reserved.ok) {
			reserved.refund();
			reserved.refund();
		}

		expect(guardrails.reserveTerminalStart(originAt(0), 0).ok).toBe(true);
	});

	// The count the cap reads is observed rather than owned — it comes from the
	// terminals that exist — so a start that has not produced one yet has to be
	// visible to the next start, or two racing calls both read the same stale
	// number and sail past the cap.
	it('counts a start that has not produced its terminal yet', () => {
		const guardrails = createGuardrails({ maxOpenTerminals: 2 });

		const first = guardrails.reserveTerminalStart(originAt(0), 1);
		const second = guardrails.reserveTerminalStart(originAt(0), 1);

		expect(first.ok).toBe(true);
		expect(second.ok).toBe(false);
		if (!second.ok) {
			expect(second.code).toBe('denied-quota');
			expect(second.reason).toContain('open or starting right now');
		}
	});

	// Once the terminal exists the listing counts it, so holding the claim any
	// longer would charge the tree for it twice.
	it('drops the claim once the terminal exists', () => {
		const guardrails = createGuardrails({ maxOpenTerminals: 2 });

		const first = guardrails.reserveTerminalStart(originAt(0), 0);
		if (first.ok) {
			first.settle();
		}

		expect(guardrails.reserveTerminalStart(originAt(0), 1).ok).toBe(true);
	});

	// A start that failed holds nothing: the terminal never joined the listing,
	// so the claim has to go back as well as the rate capacity.
	it('drops the claim when the start fails', () => {
		const guardrails = createGuardrails({ maxOpenTerminals: 1 });

		const failed = guardrails.reserveTerminalStart(originAt(0), 0);
		if (failed.ok) {
			failed.refund();
		}

		expect(guardrails.reserveTerminalStart(originAt(0), 0).ok).toBe(true);
	});

	// Two trees do not share the claim any more than they share the budget.
	it('holds a claim against one delegation tree only', () => {
		const guardrails = createGuardrails({ maxOpenTerminals: 1 });

		guardrails.reserveTerminalStart(originAt(0), 0);
		const sibling = guardrails.reserveTerminalStart(
			{ ...originAt(0), rootSessionId: 'other-root', sessionId: 'other-root' },
			0,
		);

		expect(sibling.ok).toBe(true);
	});

	// Terminals are not delegation, but they are still reached through an origin
	// the app verified, so the depth rule that stops a leaf from spawning stops
	// it from opening a PTY too.
	it('still refuses a leaf and an unverified root', () => {
		const guardrails = createGuardrails();

		const leaf = guardrails.reserveTerminalStart(originAt(2), 0);
		const unrooted = guardrails.reserveTerminalStart(
			{ ...originAt(1), rootSessionId: null },
			0,
		);

		expect(leaf.ok).toBe(false);
		expect(unrooted.ok).toBe(false);
		if (!leaf.ok) {
			expect(leaf.code).toBe('denied-depth');
		}
	});
});
