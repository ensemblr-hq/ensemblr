/**
 * The envelope every agent event is persisted and replayed as. The renderer
 * matches on `payload.kind` rather than sniffing a runtime's own frames, so a
 * variant that maps to the wrong shape breaks the timeline at read time, long
 * after the session that wrote it is gone.
 */

import { describe, expect, it } from 'vitest';
import { eventPayload } from '../../src/main/agent-runtime/agent-session-persistence.ts';
import type { AgentEvent } from '../../src/main/agent-runtime/agent-types.ts';

const AT = '2026-08-15T12:00:00.000Z';

describe('eventPayload', () => {
	it('carries a plan-limit window through unchanged', () => {
		const event: AgentEvent = {
			at: AT,
			limit: {
				status: 'allowed-warning',
				window: {
					displayName: null,
					id: 'five_hour',
					resetsAt: '2026-08-15T21:00:00.000Z',
					utilization: 84,
				},
			},
			type: 'plan-limit',
		};

		expect(eventPayload(event)).toEqual({
			kind: 'plan-limit',
			limit: {
				status: 'allowed-warning',
				window: {
					displayName: null,
					id: 'five_hour',
					resetsAt: '2026-08-15T21:00:00.000Z',
					utilization: 84,
				},
			},
		});
	});

	it('copies the plan window rather than aliasing the emitter’s object', () => {
		const window = {
			displayName: null,
			id: 'seven_day',
			resetsAt: null,
			utilization: 10,
		};
		const envelope = eventPayload({
			at: AT,
			limit: { status: 'allowed', window },
			type: 'plan-limit',
		});

		window.utilization = 99;

		expect(
			envelope.kind === 'plan-limit' ? envelope.limit.window.utilization : null,
		).toBe(10);
	});

	it('carries a session cost with its per-model breakdown', () => {
		const event: AgentEvent = {
			at: AT,
			cost: {
				models: [
					{
						cacheCreationInputTokens: 900,
						cacheReadInputTokens: 20_000,
						costUsd: 1.2,
						inputTokens: 1_000,
						model: 'claude-opus-5',
						outputTokens: 395,
					},
				],
				totalCostUsd: 1.25,
			},
			type: 'session-cost',
		};

		expect(eventPayload(event)).toEqual({
			cost: {
				models: [
					{
						cacheCreationInputTokens: 900,
						cacheReadInputTokens: 20_000,
						costUsd: 1.2,
						inputTokens: 1_000,
						model: 'claude-opus-5',
						outputTokens: 395,
					},
				],
				totalCostUsd: 1.25,
			},
			kind: 'session-cost',
		});
	});

	it('persists a cost with no per-model breakdown as an empty list, not a gap', () => {
		const envelope = eventPayload({
			at: AT,
			cost: { models: [], totalCostUsd: 0.4 },
			type: 'session-cost',
		});

		expect(envelope).toEqual({
			cost: { models: [], totalCostUsd: 0.4 },
			kind: 'session-cost',
		});
	});

	it('still maps the variants that existed before usage did', () => {
		expect(
			eventPayload({
				at: AT,
				type: 'context-usage',
				usage: { contextWindow: 200_000, percent: 25, tokens: 50_000 },
			}),
		).toEqual({
			kind: 'context-usage',
			usage: { contextWindow: 200_000, percent: 25, tokens: 50_000 },
		});
		expect(
			eventPayload({ at: AT, reason: 'completed', type: 'shutdown' }),
		).toEqual({ kind: 'shutdown', reason: 'completed' });
	});
});
