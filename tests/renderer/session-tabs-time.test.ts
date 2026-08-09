import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { i18n } from '../../src/renderer/lib/i18n';
import { formatRelativeClosedAt } from '../../src/renderer/lib/workbench/relative-time';

const NOW = new Date('2026-06-08T12:00:00.000Z').getTime();
let dateSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(async () => {
	dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => NOW);
	await i18n.changeLanguage('en');
});

afterEach(() => {
	dateSpy?.mockRestore();
	dateSpy = null;
});

test('formatRelativeClosedAt renders sub-minute deltas as "just now"', () => {
	expect(formatRelativeClosedAt('2026-06-08T11:59:59.000Z')).toBe('just now');
});

test('formatRelativeClosedAt renders minute-scale deltas', () => {
	expect(formatRelativeClosedAt('2026-06-08T11:55:00.000Z')).toMatch(
		/^5 min\.? ago$/,
	);
});

test('formatRelativeClosedAt renders hour-scale deltas', () => {
	expect(formatRelativeClosedAt('2026-06-08T09:00:00.000Z')).toMatch(
		/^3 hr\.? ago$/,
	);
});

test('formatRelativeClosedAt renders day-scale deltas', () => {
	expect(formatRelativeClosedAt('2026-06-06T12:00:00.000Z')).toBe('2 days ago');
});

test('formatRelativeClosedAt returns the input when unparseable', () => {
	expect(formatRelativeClosedAt('not-an-iso-timestamp')).toBe(
		'not-an-iso-timestamp',
	);
});

test('formatRelativeClosedAt follows the active language', async () => {
	await i18n.changeLanguage('ru');
	expect(formatRelativeClosedAt('2026-06-08T11:59:59.000Z')).toBe('только что');
	expect(formatRelativeClosedAt('2026-06-06T12:00:00.000Z')).toMatch(
		/^2 дн\.? назад$/,
	);

	await i18n.changeLanguage('el');
	expect(formatRelativeClosedAt('2026-06-08T11:55:00.000Z')).toMatch(
		/^πριν από 5 λεπ\.?$/,
	);
});
