import { describe, expect, test } from 'vitest';

import {
	advanceSetupDiagnosticsPoll,
	initialSetupDiagnosticsPollState,
	SETUP_DIAGNOSTICS_POLL_MS,
	type SetupDiagnosticsPollState,
} from '../../src/renderer/api/ensemblr/setup-diagnostics-poll';

/**
 * Runs the poll driver N times feeding the same status and a fresh completed
 * fetch each iteration, returning each interval.
 */
function run(
	status: 'blocked' | 'checking' | 'ready' | undefined,
	polls: number,
	startingFetchCount = 0,
): { intervals: (number | false)[]; state: SetupDiagnosticsPollState } {
	let state = initialSetupDiagnosticsPollState();
	const intervals: (number | false)[] = [];
	for (let i = 0; i < polls; i++) {
		const next = advanceSetupDiagnosticsPoll(
			status,
			startingFetchCount + i + 1,
			state,
		);
		intervals.push(next.intervalMs);
		state = next.state;
	}
	return { intervals, state };
}

describe('advanceSetupDiagnosticsPoll', () => {
	test('stops immediately once ready and resets the counter', () => {
		const primed = advanceSetupDiagnosticsPoll('blocked', 1, {
			lastFetchCount: 0,
			totalPolls: 3,
		});
		const ready = advanceSetupDiagnosticsPoll('ready', 2, primed.state);
		expect(ready.intervalMs).toBe(false);
		expect(ready.state).toEqual(initialSetupDiagnosticsPollState());
	});

	test('polls at the fixed cadence while blocked', () => {
		const { intervals } = run('blocked', 3);
		expect(intervals).toEqual([
			SETUP_DIAGNOSTICS_POLL_MS,
			SETUP_DIAGNOSTICS_POLL_MS,
			SETUP_DIAGNOSTICS_POLL_MS,
		]);
	});

	test('polls while checking just like blocked', () => {
		const { intervals } = run('checking', 2);
		expect(intervals).toEqual([
			SETUP_DIAGNOSTICS_POLL_MS,
			SETUP_DIAGNOSTICS_POLL_MS,
		]);
	});

	test('keeps polling on an undefined (error) status so it can self-heal', () => {
		const first = advanceSetupDiagnosticsPoll(undefined, 1, {
			lastFetchCount: 0,
			totalPolls: 0,
		});
		expect(first.intervalMs).toBe(SETUP_DIAGNOSTICS_POLL_MS);
	});

	test('does not advance the budget when no new fetch has completed', () => {
		const first = advanceSetupDiagnosticsPoll('blocked', 1, {
			lastFetchCount: 0,
			totalPolls: 0,
		});
		expect(first.state.totalPolls).toBe(1);
		const reevaluated = advanceSetupDiagnosticsPoll('blocked', 1, first.state);
		expect(reevaluated.state.totalPolls).toBe(1);
		expect(reevaluated.intervalMs).toBe(SETUP_DIAGNOSTICS_POLL_MS);
	});

	test('gives up at the ceiling so a permanently blocked setup stops polling', () => {
		const { intervals } = run('blocked', 20);
		expect(intervals.at(-1)).toBe(false);
		expect(intervals.filter((interval) => interval === false).length).toBe(6);
		expect(intervals.filter((interval) => interval !== false).length).toBe(14);
	});

	test('stays capped across re-evaluations that carry no new fetch', () => {
		const capped = run('blocked', 20).state;
		const reevaluated = advanceSetupDiagnosticsPoll(
			'blocked',
			capped.lastFetchCount,
			capped,
		);
		expect(reevaluated.intervalMs).toBe(false);
		expect(reevaluated.state).toEqual(capped);
	});

	test('re-arms after a ready → blocked regression', () => {
		const capped = run('blocked', 20).state;
		const ready = advanceSetupDiagnosticsPoll(
			'ready',
			capped.lastFetchCount + 1,
			capped,
		);
		expect(ready.state.totalPolls).toBe(0);
		const regressed = advanceSetupDiagnosticsPoll(
			'blocked',
			capped.lastFetchCount + 2,
			ready.state,
		);
		expect(regressed.intervalMs).toBe(SETUP_DIAGNOSTICS_POLL_MS);
	});
});
