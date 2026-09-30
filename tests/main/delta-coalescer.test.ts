import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
	createDeltaCoalescer,
	type DeltaRun,
	type DeltaSlot,
	type StreamingDelta,
} from '../../src/main/agent-runtime/session/delta-coalescer.ts';

const WINDOW_MS = 32;

function delta(overrides: Partial<StreamingDelta> = {}): StreamingDelta {
	return {
		at: '2026-06-08T00:00:00.000Z',
		branchId: 'branch-1',
		kind: 'text-delta',
		role: 'agent',
		sessionId: 'session-1',
		text: 'x',
		turnId: 'turn-1',
		workspaceId: 'ws-1',
		...overrides,
	};
}

function harness() {
	const runs: DeltaRun[] = [];
	let reservations = 0;
	const reserveSlot = (): DeltaSlot => {
		reservations += 1;
		return { id: `slot-${reservations}`, ordinal: reservations * 1e-6 };
	};
	const coalescer = createDeltaCoalescer({ emit: (run) => runs.push(run) });
	return {
		coalescer,
		reservations: () => reservations,
		reserveSlot,
		runs,
	};
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('createDeltaCoalescer', () => {
	test('folds adjacent compatible deltas into one run broadcast after the window', () => {
		const { coalescer, reservations, reserveSlot, runs } = harness();

		for (let index = 0; index < 50; index += 1) {
			coalescer.push(delta({ text: `t${index} ` }), reserveSlot);
		}

		expect(runs).toHaveLength(0);
		vi.advanceTimersByTime(WINDOW_MS - 1);
		expect(runs).toHaveLength(0);
		vi.advanceTimersByTime(1);

		expect(runs).toHaveLength(1);
		expect(runs[0]?.text).toBe(
			Array.from({ length: 50 }, (_, index) => `t${index} `).join(''),
		);
		expect(reservations()).toBe(1);
		expect(runs[0]?.slot).toEqual({ id: 'slot-1', ordinal: 1e-6 });
	});

	test.each([
		['another kind', { kind: 'reasoning-delta' as const }],
		['a subagent thread', { parentToolCallId: 'toolu_1' }],
		['another turn', { turnId: 'turn-2' }],
		['another branch', { branchId: 'branch-2' }],
		['another role', { role: 'tool' as const }],
	])(
		'a delta from %s closes the open run and opens its own',
		(_label, change) => {
			const { coalescer, reservations, reserveSlot, runs } = harness();

			coalescer.push(delta({ text: 'a' }), reserveSlot);
			coalescer.push(delta({ text: 'b' }), reserveSlot);
			coalescer.push(delta({ text: 'c', ...change }), reserveSlot);

			expect(runs.map((run) => run.text)).toEqual(['ab']);
			vi.advanceTimersByTime(WINDOW_MS);
			expect(runs.map((run) => run.text)).toEqual(['ab', 'c']);
			expect(reservations()).toBe(2);
		},
	);

	test('joins only the run it is adjacent to, never an earlier one of its kind', () => {
		const { coalescer, reserveSlot, runs } = harness();

		coalescer.push(delta({ text: 'a' }), reserveSlot);
		coalescer.push(delta({ kind: 'reasoning-delta', text: 'r' }), reserveSlot);
		coalescer.push(delta({ text: 'b' }), reserveSlot);
		vi.advanceTimersByTime(WINDOW_MS);

		expect(runs.map((run) => [run.kind, run.text])).toEqual([
			['text-delta', 'a'],
			['reasoning-delta', 'r'],
			['text-delta', 'b'],
		]);
	});

	test('folds deltas of one subagent thread together', () => {
		const { coalescer, reserveSlot, runs } = harness();

		coalescer.push(
			delta({ parentToolCallId: 'toolu_1', text: 'a' }),
			reserveSlot,
		);
		coalescer.push(
			delta({ parentToolCallId: 'toolu_1', text: 'b' }),
			reserveSlot,
		);
		vi.advanceTimersByTime(WINDOW_MS);

		expect(runs.map((run) => [run.parentToolCallId, run.text])).toEqual([
			['toolu_1', 'ab'],
		]);
	});

	test('flush broadcasts a session run at once and leaves nothing for the timer', () => {
		const { coalescer, reserveSlot, runs } = harness();

		coalescer.push(delta({ text: 'a' }), reserveSlot);
		coalescer.push(delta({ text: 'b' }), reserveSlot);
		coalescer.flush('session-1');

		expect(runs.map((run) => run.text)).toEqual(['ab']);
		vi.advanceTimersByTime(WINDOW_MS * 4);
		expect(runs).toHaveLength(1);
	});

	test('flush for a session with no open run does nothing', () => {
		const { coalescer, runs } = harness();

		coalescer.flush('session-1');

		expect(runs).toHaveLength(0);
	});

	test('keeps each session in its own run', () => {
		const { coalescer, reserveSlot, runs } = harness();

		coalescer.push(delta({ sessionId: 'session-1', text: 'a' }), reserveSlot);
		coalescer.push(delta({ sessionId: 'session-2', text: 'x' }), reserveSlot);
		coalescer.push(delta({ sessionId: 'session-1', text: 'b' }), reserveSlot);
		expect(runs).toHaveLength(0);

		coalescer.flush('session-1');
		expect(runs.map((run) => [run.sessionId, run.text])).toEqual([
			['session-1', 'ab'],
		]);

		vi.advanceTimersByTime(WINDOW_MS);
		expect(runs.map((run) => [run.sessionId, run.text])).toEqual([
			['session-1', 'ab'],
			['session-2', 'x'],
		]);
	});

	test('a run whose broadcast throws is still closed', () => {
		const emitted: string[] = [];
		let failNext = true;
		const coalescer = createDeltaCoalescer({
			emit: (run) => {
				if (failNext) {
					failNext = false;
					throw new Error('renderer gone');
				}
				emitted.push(run.text);
			},
		});
		const reserveSlot = (): DeltaSlot => ({ id: 'slot', ordinal: 1e-6 });

		coalescer.push(delta({ text: 'a' }), reserveSlot);
		expect(() => coalescer.flush('session-1')).toThrow('renderer gone');
		coalescer.push(delta({ text: 'b' }), reserveSlot);
		coalescer.flush('session-1');

		expect(emitted).toEqual(['b']);
	});

	test('opens a fresh run for the first delta after a window closed', () => {
		const { coalescer, reservations, reserveSlot, runs } = harness();

		coalescer.push(delta({ text: 'a' }), reserveSlot);
		vi.advanceTimersByTime(WINDOW_MS);
		coalescer.push(delta({ text: 'b' }), reserveSlot);
		vi.advanceTimersByTime(WINDOW_MS);

		expect(runs.map((run) => [run.slot.id, run.text])).toEqual([
			['slot-1', 'a'],
			['slot-2', 'b'],
		]);
		expect(reservations()).toBe(2);
	});
});
