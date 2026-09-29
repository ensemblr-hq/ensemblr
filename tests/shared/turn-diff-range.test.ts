import { describe, expect, it } from 'vitest';

import {
	resolveTurnDiffEnds,
	type TurnRangeInput,
} from '@/shared/turn-diff-range';

/** A captured turn whose checkpoint commit is its id repeated. */
function turn(
	id: string,
	overrides: Partial<TurnRangeInput> & { at: string },
): TurnRangeInput {
	const { at, ...rest } = overrides;
	return {
		agentSessionId: 'session-a',
		checkpointCreatedAt: at,
		checkpointHash: hashOf(id),
		checkpointId: `checkpoint-${id}`,
		endFailed: false,
		endHash: null,
		recordsEnd: false,
		settled: false,
		settledAt: null,
		turnId: `turn-${id}`,
		...rest,
	};
}

/**
 * A turn whose opening capture has no commit.
 * @param state - `failed` wrote a row without a commit; `opening` has no row yet
 */
function uncaptured(id: string, state: 'failed' | 'opening'): TurnRangeInput {
	return {
		agentSessionId: 'session-a',
		checkpointCreatedAt: state === 'failed' ? '2026-09-29T10:06:00.000Z' : null,
		checkpointHash: null,
		checkpointId: state === 'failed' ? `checkpoint-${id}` : null,
		endFailed: false,
		endHash: null,
		recordsEnd: false,
		settled: false,
		settledAt: null,
		turnId: `turn-${id}`,
	};
}

/** The fake commit hash a test turn's checkpoint carries. */
function hashOf(id: string): string {
	return id.repeat(40).slice(0, 40);
}

const idle = new Set<string>();
const busyA = new Set(['session-a']);
const open = new Set(['session-a', 'session-b']);
const NOW = Date.parse('2026-09-29T12:00:00.000Z');
const JUST_NOW = '2026-09-29T11:59:59.000Z';
const HOURS_AGO = '2026-09-29T08:00:00.000Z';

describe('resolveTurnDiffEnds', () => {
	it('locks a turn to the end it recorded, whatever came after', () => {
		const ends = resolveTurnDiffEnds({
			now: NOW,
			openSessionIds: open,
			busySessionIds: busyA,
			turns: [
				turn('a', {
					at: '2026-09-29T10:00:00.000Z',
					endHash: hashOf('e'),
					settled: true,
				}),
				turn('b', { at: '2026-09-29T10:05:00.000Z' }),
			],
		});

		expect(ends.get('turn-a')).toEqual({
			gitHash: hashOf('e'),
			kind: 'checkpoint',
		});
	});

	it('runs the turn in flight to the working tree', () => {
		const ends = resolveTurnDiffEnds({
			now: NOW,
			openSessionIds: open,
			busySessionIds: busyA,
			turns: [
				turn('a', {
					at: '2026-09-29T10:00:00.000Z',
					endHash: hashOf('b'),
					settled: true,
				}),
				turn('b', { at: '2026-09-29T10:05:00.000Z' }),
			],
		});

		expect(ends.get('turn-b')).toEqual({ kind: 'working-tree' });
	});

	it('reads a turn that just stopped live while its end is written, then never again', () => {
		const pending = resolveTurnDiffEnds({
			now: NOW,
			openSessionIds: open,
			busySessionIds: idle,
			turns: [turn('a', { at: HOURS_AGO, settled: true, settledAt: JUST_NOW })],
		});
		const expired = resolveTurnDiffEnds({
			now: NOW,
			openSessionIds: open,
			busySessionIds: idle,
			turns: [
				turn('a', { at: HOURS_AGO, settled: true, settledAt: HOURS_AGO }),
			],
		});

		expect(pending.get('turn-a')).toEqual({ kind: 'working-tree' });
		// The app went away before the end landed: anything diffed past the turn
		// would be someone else's work.
		expect(expired.get('turn-a')).toEqual({ kind: 'unknown' });
	});

	it('does not wait for an end a closed session can no longer write', () => {
		const ends = resolveTurnDiffEnds({
			now: NOW,
			openSessionIds: idle,
			busySessionIds: idle,
			turns: [turn('a', { at: HOURS_AGO, settled: true, settledAt: JUST_NOW })],
		});

		expect(ends.get('turn-a')).toEqual({ kind: 'unknown' });
	});

	it('withholds a turn whose end was lost, even with a turn after it', () => {
		const ends = resolveTurnDiffEnds({
			now: NOW,
			openSessionIds: open,
			busySessionIds: idle,
			turns: [
				turn('a', {
					at: '2026-09-29T10:00:00.000Z',
					endFailed: true,
					settled: true,
					settledAt: HOURS_AGO,
				}),
				turn('b', { at: '2026-09-29T10:05:00.000Z' }),
			],
		});

		expect(ends.get('turn-a')).toEqual({ kind: 'unknown' });
	});

	it('falls back to the next turn in the session when no end was recorded', () => {
		const ends = resolveTurnDiffEnds({
			now: NOW,
			openSessionIds: open,
			busySessionIds: idle,
			turns: [
				turn('a', { at: '2026-09-29T10:00:00.000Z' }),
				turn('b', { at: '2026-09-29T10:05:00.000Z', settled: true }),
			],
		});

		expect(ends.get('turn-a')).toEqual({
			gitHash: hashOf('b'),
			kind: 'checkpoint',
		});
	});

	it("reads a turn live while the next input's snapshot is being taken", () => {
		const ends = resolveTurnDiffEnds({
			now: NOW,
			openSessionIds: open,
			busySessionIds: busyA,
			turns: [
				turn('a', { at: '2026-09-29T10:00:00.000Z' }),
				uncaptured('b', 'opening'),
			],
		});

		// The runtime has not been handed the new input yet, so the tree is still
		// exactly where turn `a` left it.
		expect(ends.get('turn-a')).toEqual({ kind: 'working-tree' });
	});

	it('withholds the range when the next turn failed to capture a checkpoint', () => {
		const ends = resolveTurnDiffEnds({
			now: NOW,
			openSessionIds: open,
			busySessionIds: busyA,
			turns: [
				turn('a', { at: '2026-09-29T10:00:00.000Z' }),
				uncaptured('b', 'failed'),
				turn('c', { at: '2026-09-29T10:10:00.000Z' }),
			],
		});

		// Diffing on to `c` would report `b`'s changes as `a`'s.
		expect(ends.get('turn-a')).toEqual({ kind: 'unknown' });
		expect(ends.has('turn-b')).toBe(false);
	});

	it("bounds an old session's last turn by the next checkpoint any chat took after it", () => {
		const ends = resolveTurnDiffEnds({
			now: NOW,
			openSessionIds: open,
			busySessionIds: new Set(['session-b']),
			turns: [
				turn('a', { at: '2026-09-29T10:00:00.000Z' }),
				turn('y', {
					agentSessionId: 'session-b',
					at: '2026-09-29T09:00:00.000Z',
					endHash: hashOf('x'),
					settled: true,
				}),
				turn('z', {
					agentSessionId: 'session-b',
					at: '2026-09-29T10:01:00.000Z',
				}),
			],
		});

		// Session b's first turn was captured before `a`, so it does not bound it.
		expect(ends.get('turn-a')).toEqual({
			gitHash: hashOf('z'),
			kind: 'checkpoint',
		});
		expect(ends.get('turn-z')).toEqual({ kind: 'working-tree' });
	});

	it('withholds a turn whose runtime went away before it settled', () => {
		const ends = resolveTurnDiffEnds({
			now: NOW,
			openSessionIds: idle,
			busySessionIds: idle,
			turns: [
				turn('a', { at: '2026-09-29T10:00:00.000Z', recordsEnd: true }),
				turn('z', {
					agentSessionId: 'session-b',
					at: '2026-09-29T10:01:00.000Z',
				}),
			],
		});

		// A crash left the row unsettled; another chat's later capture is not
		// where this turn stopped.
		expect(ends.get('turn-a')).toEqual({ kind: 'unknown' });
	});

	it('never lets a turn a crash left open borrow the next prompt as its end', () => {
		const ends = resolveTurnDiffEnds({
			now: NOW,
			openSessionIds: open,
			busySessionIds: busyA,
			turns: [
				turn('a', { at: '2026-09-29T10:00:00.000Z', recordsEnd: true }),
				turn('b', { at: '2026-09-29T11:00:00.000Z' }),
			],
		});

		// Everything between the crash and prompt `b` would otherwise read as `a`'s.
		expect(ends.get('turn-a')).toEqual({ kind: 'unknown' });
		expect(ends.get('turn-b')).toEqual({ kind: 'working-tree' });
	});

	it("leaves an old session's last turn unknown when nothing followed it", () => {
		const ends = resolveTurnDiffEnds({
			now: NOW,
			openSessionIds: open,
			busySessionIds: idle,
			turns: [turn('a', { at: '2026-09-29T10:00:00.000Z' })],
		});

		expect(ends.get('turn-a')).toEqual({ kind: 'unknown' });
	});

	it('orders captures by timestamp then id, the way SQLite does', () => {
		const at = '2026-09-29T10:00:00.000Z';
		const ends = resolveTurnDiffEnds({
			now: NOW,
			openSessionIds: open,
			busySessionIds: idle,
			turns: [
				turn('b', { agentSessionId: 'session-b', at, checkpointId: 'id-2' }),
				turn('a', { at, checkpointId: 'id-1' }),
			],
		});

		expect(ends.get('turn-a')).toEqual({
			gitHash: hashOf('b'),
			kind: 'checkpoint',
		});
		expect(ends.get('turn-b')).toEqual({ kind: 'unknown' });
	});
});
