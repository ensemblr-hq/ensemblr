/**
 * How a chat's plan gauge is assembled. The runtime polls every window when a
 * session opens and pushes one window at a time after that, so the fold has to
 * keep windows it was not told about this time, keep a figure a push declined to
 * restate, and survive a session's events being replayed from scratch.
 */

import { describe, expect, it } from 'vitest';

import {
	foldPlanUsage,
	foldTaggedPlanUsage,
	type PlanUsageReading,
	planUsageFromEvents,
	resolvePlanUsage,
	toPlanUsageReading,
} from '@/renderer/state/composer/plan-usage';
import type {
	AgentPlanLimitStatusWire,
	AgentPlanLimitWindowWire,
	AgentSessionEventWire,
} from '@/shared/ipc/contracts/agent-session';

/** A pushed reading for one window. */
function limit(
	id: string,
	utilization: number | null,
	status: AgentPlanLimitStatusWire = 'allowed',
): Extract<PlanUsageReading, { kind: 'limit' }> {
	return {
		kind: 'limit',
		limit: {
			status,
			window: { displayName: null, id, resetsAt: null, utilization },
		},
	};
}

/** A polled read naming every window the plan reports. */
function windows(
	...reported: readonly AgentPlanLimitWindowWire[]
): Extract<PlanUsageReading, { kind: 'windows' }> {
	return { kind: 'windows', windows: reported };
}

/** One window as a polled read describes it. */
function window(
	id: string,
	utilization: number | null,
	resetsAt: string | null = null,
): AgentPlanLimitWindowWire {
	return { displayName: null, id, resetsAt, utilization };
}

/** A sealed turn's cost reading. */
function cost(
	totalCostUsd: number,
): Extract<PlanUsageReading, { kind: 'cost' }> {
	return { cost: { models: [], totalCostUsd }, kind: 'cost' };
}

/** Wraps envelopes as the persisted events a session replays. */
function events(
	payloads: readonly AgentSessionEventWire['payload'][],
): readonly AgentSessionEventWire[] {
	return payloads.map(
		(payload, index) =>
			({
				createdAt: '2026-08-15T00:00:00.000Z',
				eventType: payload?.kind ?? 'unknown',
				id: `event-${index}`,
				payload,
				seq: index,
				stream: 'protocol',
			}) as unknown as AgentSessionEventWire,
	);
}

describe('toPlanUsageReading', () => {
	it('reads each plan envelope as the slice it describes', () => {
		expect(
			toPlanUsageReading({
				kind: 'plan-limit',
				limit: limit('five_hour', 20).limit,
			})?.kind,
		).toBe('limit');
		expect(
			toPlanUsageReading({
				kind: 'plan-windows',
				windows: [window('five_hour', 20)],
			})?.kind,
		).toBe('windows');
		expect(
			toPlanUsageReading({
				cost: { models: [], totalCostUsd: 1 },
				kind: 'session-cost',
			})?.kind,
		).toBe('cost');
	});

	it('leaves envelopes that say nothing about the plan to their own handlers', () => {
		expect(
			toPlanUsageReading({
				kind: 'context-usage',
				usage: { contextWindow: 200_000, percent: 10, tokens: 20_000 },
			}),
		).toBeNull();
		expect(
			toPlanUsageReading({ kind: 'shutdown', reason: 'completed' }),
		).toBeNull();
		expect(toPlanUsageReading(null)).toBeNull();
		expect(toPlanUsageReading(undefined)).toBeNull();
	});
});

describe('foldPlanUsage', () => {
	it('keeps windows a later push did not mention', () => {
		const first = foldPlanUsage(null, limit('five_hour', 20));
		const second = foldPlanUsage(first, limit('seven_day', 55));

		expect(second.limits.map((reported) => reported.id)).toEqual([
			'five_hour',
			'seven_day',
		]);
	});

	it('replaces a window in place rather than appending a second reading', () => {
		const first = foldPlanUsage(null, limit('five_hour', 20));
		const second = foldPlanUsage(first, limit('five_hour', 61));

		expect(second.limits).toEqual([
			{
				displayName: null,
				id: 'five_hour',
				resetsAt: null,
				utilization: 61,
			},
		]);
	});

	it('takes the spend verdict from the newest push', () => {
		const warned = foldPlanUsage(
			null,
			limit('five_hour', 95, 'allowed-warning'),
		);

		expect(warned.status).toBe('allowed-warning');
		expect(foldPlanUsage(warned, limit('seven_day', 10)).status).toBe(
			'allowed',
		);
	});

	it('leaves the windows alone when only the cost moved', () => {
		const withWindow = foldPlanUsage(null, limit('five_hour', 20));
		const withCost = foldPlanUsage(withWindow, cost(0.44));

		expect(withCost.limits).toEqual(withWindow.limits);
		expect(withCost.totalCostUsd).toBe(0.44);
	});

	it('starts a session with no cost rather than a zero it never measured', () => {
		expect(foldPlanUsage(null, limit('five_hour', 20)).totalCostUsd).toBeNull();
	});

	it('seeds every window a polled read named', () => {
		const polled = foldPlanUsage(
			null,
			windows(window('five_hour', 12), window('seven_day', 40)),
		);

		expect(polled.limits).toEqual([
			{ displayName: null, id: 'five_hour', resetsAt: null, utilization: 12 },
			{ displayName: null, id: 'seven_day', resetsAt: null, utilization: 40 },
		]);
	});

	it('announces no verdict for a read, which judges nothing', () => {
		expect(
			foldPlanUsage(null, windows(window('five_hour', 12))).status,
		).toBeNull();
	});

	it('leaves a pushed verdict standing when a later read names the same window', () => {
		const rejected = foldPlanUsage(null, limit('five_hour', 95, 'rejected'));

		expect(
			foldPlanUsage(rejected, windows(window('five_hour', 96))).status,
		).toBe('rejected');
	});

	it('keeps a polled figure a push declined to restate', () => {
		const polled = foldPlanUsage(
			null,
			windows(window('five_hour', 12, '2026-08-15T04:00:00.000Z')),
		);
		const pushed = foldPlanUsage(polled, limit('five_hour', null));

		expect(pushed.limits).toEqual([
			{
				displayName: null,
				id: 'five_hour',
				resetsAt: '2026-08-15T04:00:00.000Z',
				utilization: 12,
			},
		]);
	});

	it('takes a reset window at zero rather than as an absent reading', () => {
		const polled = foldPlanUsage(null, windows(window('five_hour', 88)));

		expect(
			foldPlanUsage(polled, limit('five_hour', 0)).limits.at(0)?.utilization,
		).toBe(0);
	});
});

describe('foldTaggedPlanUsage', () => {
	it('accumulates readings that keep naming the same session', () => {
		const first = foldTaggedPlanUsage(null, {
			...limit('five_hour', 20),
			sessionId: 'session-1',
		});
		const second = foldTaggedPlanUsage(first, {
			...limit('seven_day', 44),
			sessionId: 'session-1',
		});

		expect(second.usage.limits.map((reported) => reported.id)).toEqual([
			'five_hour',
			'seven_day',
		]);
	});

	it('restarts when the reading names a different session', () => {
		const first = foldTaggedPlanUsage(null, {
			...limit('five_hour', 20),
			sessionId: 'session-1',
		});
		const second = foldTaggedPlanUsage(first, {
			...limit('seven_day', 44),
			sessionId: 'session-2',
		});

		expect(second.sessionId).toBe('session-2');
		expect(second.usage.limits.map((reported) => reported.id)).toEqual([
			'seven_day',
		]);
	});
});

describe('planUsageFromEvents', () => {
	it('replays a session so reopening a chat restores its gauge', () => {
		const usage = planUsageFromEvents(
			events([
				{ kind: 'plan-limit', limit: limit('five_hour', 20).limit },
				{ cost: { models: [], totalCostUsd: 0.9 }, kind: 'session-cost' },
				{ kind: 'plan-limit', limit: limit('five_hour', 44).limit },
			]),
		);

		expect(usage).toEqual({
			limits: [
				{
					displayName: null,
					id: 'five_hour',
					resetsAt: null,
					utilization: 44,
				},
			],
			status: 'allowed',
			totalCostUsd: 0.9,
		});
	});

	it('replays a polled read, so a reopened chat shows every window', () => {
		const usage = planUsageFromEvents(
			events([
				{
					kind: 'plan-windows',
					windows: [window('five_hour', 12), window('seven_day', 40)],
				},
				{ kind: 'plan-limit', limit: limit('five_hour', null).limit },
			]),
		);

		expect(usage?.limits).toEqual([
			{ displayName: null, id: 'five_hour', resetsAt: null, utilization: 12 },
			{ displayName: null, id: 'seven_day', resetsAt: null, utilization: 40 },
		]);
	});

	it('reports nothing for a session that never mentioned usage', () => {
		expect(
			planUsageFromEvents(events([{ kind: 'shutdown', reason: 'completed' }])),
		).toBeNull();
	});
});

describe('resolvePlanUsage', () => {
	const SESSION = 'session-1';

	const persisted = planUsageFromEvents(
		events([
			{ kind: 'plan-limit', limit: limit('five_hour', 62).limit },
			{ kind: 'plan-limit', limit: limit('seven_day', 31).limit },
			{ cost: { models: [], totalCostUsd: 0.5 }, kind: 'session-cost' },
		]),
	);

	/** Tags a folded snapshot as the live reading of a given session. */
	function live(usage: ReturnType<typeof foldPlanUsage>, sessionId = SESSION) {
		return { sessionId, usage };
	}

	/** Resolves against the persisted fixture and the bound session. */
	function resolve(
		liveUsage: {
			sessionId: string;
			usage: ReturnType<typeof foldPlanUsage>;
		} | null,
	) {
		return resolvePlanUsage({
			live: liveUsage,
			persisted,
			sessionId: SESSION,
		});
	}

	it('keeps the replayed windows when the live half only sealed a cost', () => {
		const resolved = resolve(live(foldPlanUsage(null, cost(1.25))));

		expect(resolved?.limits.map((reported) => reported.id)).toEqual([
			'five_hour',
			'seven_day',
		]);
		expect(resolved?.totalCostUsd).toBe(1.25);
	});

	it('layers a live window over its replayed reading without dropping the rest', () => {
		const resolved = resolve(live(foldPlanUsage(null, limit('five_hour', 88))));

		expect(resolved?.limits).toEqual([
			{ displayName: null, id: 'five_hour', resetsAt: null, utilization: 88 },
			{ displayName: null, id: 'seven_day', resetsAt: null, utilization: 31 },
		]);
	});

	it('appends a window the replay never named', () => {
		const resolved = resolve(
			live(foldPlanUsage(null, limit('seven_day_opus', 12))),
		);

		expect(resolved?.limits.at(-1)?.id).toBe('seven_day_opus');
	});

	it('keeps the replayed cost while the live half has measured none', () => {
		const resolved = resolve(live(foldPlanUsage(null, limit('five_hour', 88))));

		expect(resolved?.totalCostUsd).toBe(0.5);
	});

	it('takes the verdict from the live half only once one has been announced', () => {
		const rejected = foldPlanUsage(null, limit('five_hour', 95, 'rejected'));

		expect(resolve(live(rejected))?.status).toBe('rejected');
		expect(resolve(live(foldPlanUsage(null, cost(2))))?.status).toBe('allowed');
	});

	it('keeps the replayed verdict when the live half has only polled', () => {
		const warned = planUsageFromEvents(
			events([
				{
					kind: 'plan-limit',
					limit: limit('five_hour', 62, 'allowed-warning').limit,
				},
			]),
		);
		const polled = foldPlanUsage(null, windows(window('five_hour', 64)));

		expect(
			resolvePlanUsage({
				live: live(polled),
				persisted: warned,
				sessionId: SESSION,
			})?.status,
		).toBe('allowed-warning');
	});

	it('ignores a live reading left over from the previous chat', () => {
		const stale = live(
			foldPlanUsage(null, limit('five_hour', 99)),
			'session-0',
		);

		expect(resolve(stale)).toEqual(persisted);
	});

	it('falls back to whichever half exists', () => {
		expect(resolve(null)).toEqual(persisted);
		expect(
			resolvePlanUsage({ live: null, persisted: null, sessionId: SESSION }),
		).toBeNull();
		const only = live(foldPlanUsage(null, limit('five_hour', 7)));
		expect(
			resolvePlanUsage({ live: only, persisted: null, sessionId: SESSION }),
		).toEqual(only.usage);
	});
});
