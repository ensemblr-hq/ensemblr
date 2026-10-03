import { describe, expect, test } from 'vitest';

import {
	formatElapsedSeconds,
	formatTurnDuration,
} from '../../src/renderer/lib/format-duration';

describe('formatTurnDuration', () => {
	test('sub-minute values show one decimal of seconds', () => {
		expect(formatTurnDuration(500)).toBe('0.5s');
		expect(formatTurnDuration(1_800)).toBe('1.8s');
		expect(formatTurnDuration(14_300)).toBe('14.3s');
	});

	test('past a minute shows minutes plus decimal seconds (reference)', () => {
		expect(formatTurnDuration(61_000)).toBe('1m, 1.0s');
		expect(formatTurnDuration(691_800)).toBe('11m, 31.8s');
	});

	test('past an hour shows full chain incl. zero minutes', () => {
		expect(formatTurnDuration(3_600_000)).toBe('1h, 0m, 0.0s');
		expect(formatTurnDuration(3_905_300)).toBe('1h, 5m, 5.3s');
	});

	test('rounds at the boundary without rolling seconds to 60', () => {
		expect(formatTurnDuration(59_950)).toBe('1m, 0.0s');
	});

	test('clamps negative input to zero', () => {
		expect(formatTurnDuration(-5)).toBe('0.0s');
	});
});

describe('formatElapsedSeconds', () => {
	test('sub-minute values show whole seconds without a decimal', () => {
		expect(formatElapsedSeconds(0)).toBe('0s');
		expect(formatElapsedSeconds(37_900)).toBe('37s');
	});

	test('past a minute pads the seconds', () => {
		expect(formatElapsedSeconds(60_000)).toBe('1m 00s');
		expect(formatElapsedSeconds(125_400)).toBe('2m 05s');
	});

	test('past an hour drops the seconds and pads the minutes', () => {
		expect(formatElapsedSeconds(3_600_000)).toBe('1h 00m');
		expect(formatElapsedSeconds(3_725_000)).toBe('1h 02m');
	});

	test('clamps negative input to zero', () => {
		expect(formatElapsedSeconds(-5)).toBe('0s');
	});
});
