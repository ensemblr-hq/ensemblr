import { describe, expect, it } from 'vitest';

import {
	readPlanUsage,
	toPlanLimit,
	toSessionCost,
} from '../../src/main/claude-agent/claude-usage.ts';

/** The `rate_limits` block a Max subscription reports, trimmed to what is read. */
function rateLimits(): Record<string, unknown> {
	return {
		five_hour: { resets_at: '2026-08-15T21:00:00.000Z', utilization: 62 },
		model_scoped: [
			{
				display_name: 'Fable',
				resets_at: '2026-08-19T09:00:00.000Z',
				utilization: 12,
			},
		],
		seven_day: { resets_at: '2026-08-19T09:00:00.000Z', utilization: 31 },
		seven_day_opus: {
			resets_at: '2026-08-19T09:00:00.000Z',
			utilization: null,
		},
	};
}

/** A session stub whose usage control request resolves to the given response. */
function sessionReporting(response: unknown): never {
	return {
		usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () =>
			response,
	} as never;
}

describe('readPlanUsage', () => {
	it('flattens every reported window, named ones before per-model buckets', async () => {
		const usage = await readPlanUsage(
			sessionReporting({
				rate_limits: rateLimits(),
				rate_limits_available: true,
				subscription_type: 'max',
			}),
		);

		expect(usage).toEqual({
			available: true,
			limits: [
				{
					displayName: null,
					id: 'five_hour',
					resetsAt: '2026-08-15T21:00:00.000Z',
					utilization: 62,
				},
				{
					displayName: null,
					id: 'seven_day',
					resetsAt: '2026-08-19T09:00:00.000Z',
					utilization: 31,
				},
				{
					displayName: null,
					id: 'seven_day_opus',
					resetsAt: '2026-08-19T09:00:00.000Z',
					utilization: null,
				},
				{
					displayName: 'Fable',
					id: 'Fable',
					resetsAt: '2026-08-19T09:00:00.000Z',
					utilization: 12,
				},
			],
			subscriptionType: 'max',
		});
	});

	it('reports an API-key session as having no plan limits rather than empty ones', async () => {
		const usage = await readPlanUsage(
			sessionReporting({
				rate_limits: null,
				rate_limits_available: false,
				subscription_type: null,
			}),
		);

		expect(usage).toEqual({
			available: false,
			limits: [],
			subscriptionType: null,
		});
	});

	it('reads a runtime that rejects the control request as unavailable, not as a failure', async () => {
		const usage = await readPlanUsage({
			usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
				throw new Error('unknown control request: get_usage');
			},
		} as never);

		expect(usage).toBeNull();
	});

	it('survives a runtime that does not implement the method at all', async () => {
		await expect(readPlanUsage({} as never)).resolves.toBeNull();
	});
});

describe('toPlanLimit', () => {
	it('maps a pushed window, converting its epoch-second reset to an instant', () => {
		expect(
			toPlanLimit({
				rateLimitType: 'seven_day',
				resetsAt: 1_786_024_800,
				status: 'allowed',
				utilization: 44,
			}),
		).toEqual({
			status: 'allowed',
			window: {
				displayName: null,
				id: 'seven_day',
				resetsAt: '2026-08-06T14:00:00.000Z',
				utilization: 44,
			},
		});
	});

	it('reads a millisecond reset stamp without landing in the year 56000', () => {
		const limit = toPlanLimit({
			rateLimitType: 'five_hour',
			resetsAt: 1_786_024_800_000,
			status: 'allowed',
		});

		expect(limit?.window.resetsAt).toBe('2026-08-06T14:00:00.000Z');
	});

	it('carries the runtime warning through as its own status', () => {
		expect(
			toPlanLimit({ rateLimitType: 'overage', status: 'allowed_warning' })
				?.status,
		).toBe('allowed-warning');
		expect(
			toPlanLimit({ rateLimitType: 'overage', status: 'rejected' })?.status,
		).toBe('rejected');
	});

	it('drops a frame that names no window', () => {
		expect(toPlanLimit({ status: 'allowed' })).toBeNull();
		expect(toPlanLimit(undefined)).toBeNull();
	});
});

describe('toSessionCost', () => {
	it('keys per-model counters by the model string the turn ran under', () => {
		expect(
			toSessionCost(1.25, {
				'claude-opus-5': {
					cacheCreationInputTokens: 900,
					cacheReadInputTokens: 20_000,
					contextWindow: 200_000,
					costUSD: 1.2,
					inputTokens: 1_000,
					maxOutputTokens: 64_000,
					outputTokens: 395,
					webSearchRequests: 0,
				},
				'claude-haiku-4-5-20251001': {
					cacheCreationInputTokens: 0,
					cacheReadInputTokens: 0,
					contextWindow: 200_000,
					costUSD: 0.05,
					inputTokens: 300,
					maxOutputTokens: 8_000,
					outputTokens: 40,
					webSearchRequests: 0,
				},
			}),
		).toEqual({
			models: [
				{
					cacheCreationInputTokens: 900,
					cacheReadInputTokens: 20_000,
					costUsd: 1.2,
					inputTokens: 1_000,
					model: 'claude-opus-5',
					outputTokens: 395,
				},
				{
					cacheCreationInputTokens: 0,
					cacheReadInputTokens: 0,
					costUsd: 0.05,
					inputTokens: 300,
					model: 'claude-haiku-4-5-20251001',
					outputTokens: 40,
				},
			],
			totalCostUsd: 1.25,
		});
	});

	it('reports a total with no per-model breakdown when the runtime sent none', () => {
		expect(toSessionCost(0.4, undefined)).toEqual({
			models: [],
			totalCostUsd: 0.4,
		});
	});
});
