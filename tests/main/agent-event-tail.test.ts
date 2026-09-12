import { describe, expect, it } from 'vitest';

import {
	DEFAULT_AGENT_EVENT_TAIL,
	listAgentSessionEventsRequestSchema,
	MAX_AGENT_EVENT_TAIL,
} from '../../src/main/ipc/request-schemas/agent-session.ts';

describe('listAgentSessionEventsRequestSchema', () => {
	it('bounds a request that names no window', () => {
		expect(
			listAgentSessionEventsRequestSchema.parse({ branchId: 'branch-1' }),
		).toEqual({ branchId: 'branch-1', limit: DEFAULT_AGENT_EVENT_TAIL });
	});

	it('accepts an explicit window and a scroll-back cursor', () => {
		expect(
			listAgentSessionEventsRequestSchema.parse({
				beforeOrdinal: 400,
				branchId: 'branch-1',
				limit: 200,
			}),
		).toEqual({ beforeOrdinal: 400, branchId: 'branch-1', limit: 200 });
	});

	it('refuses a window past the ceiling', () => {
		expect(() =>
			listAgentSessionEventsRequestSchema.parse({
				branchId: 'branch-1',
				limit: MAX_AGENT_EVENT_TAIL + 1,
			}),
		).toThrow();
	});

	it('refuses a negative cursor and a zero window', () => {
		expect(() =>
			listAgentSessionEventsRequestSchema.parse({
				beforeOrdinal: -1,
				branchId: 'branch-1',
			}),
		).toThrow();
		expect(() =>
			listAgentSessionEventsRequestSchema.parse({
				branchId: 'branch-1',
				limit: 0,
			}),
		).toThrow();
	});
});
