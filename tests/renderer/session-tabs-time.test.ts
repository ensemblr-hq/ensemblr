import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { formatRelativeClosedAt } from '../../src/renderer/state/workspace';

const NOW = new Date('2026-06-08T12:00:00.000Z').getTime();
let dateSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
	dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => NOW);
});

afterEach(() => {
	dateSpy?.mockRestore();
	dateSpy = null;
});

test('formatRelativeClosedAt renders sub-minute deltas as "just now"', () => {
	expect(formatRelativeClosedAt('2026-06-08T11:59:59.000Z')).toBe('just now');
});

test('formatRelativeClosedAt renders minute-scale deltas with m suffix', () => {
	expect(formatRelativeClosedAt('2026-06-08T11:55:00.000Z')).toBe('5m ago');
});

test('formatRelativeClosedAt renders hour-scale deltas with h suffix', () => {
	expect(formatRelativeClosedAt('2026-06-08T09:00:00.000Z')).toBe('3h ago');
});

test('formatRelativeClosedAt renders day-scale deltas with d suffix', () => {
	expect(formatRelativeClosedAt('2026-06-06T12:00:00.000Z')).toBe('2d ago');
});

test('formatRelativeClosedAt returns the input when unparseable', () => {
	expect(formatRelativeClosedAt('not-an-iso-timestamp')).toBe(
		'not-an-iso-timestamp',
	);
});
