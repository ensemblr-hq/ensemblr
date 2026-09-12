import { describe, expect, test } from 'vitest';

import { mapWithConcurrency } from '../../src/main/concurrency/index.ts';

/** Resolves after `ms`, so a test can hold a slot open deterministically. */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('mapWithConcurrency', () => {
	test('preserves input order in the result', async () => {
		const results = await mapWithConcurrency([5, 1, 3], 2, async (value) => {
			await delay(value);
			return value * 2;
		});

		expect(results).toEqual([10, 2, 6]);
	});

	test('never runs more than the limit at once', async () => {
		let running = 0;
		let peak = 0;

		await mapWithConcurrency(
			Array.from({ length: 20 }, (_, index) => index),
			4,
			async () => {
				running += 1;
				peak = Math.max(peak, running);
				await delay(2);
				running -= 1;
			},
		);

		expect(peak).toBe(4);
	});

	test('runs everything when the limit exceeds the input', async () => {
		const seen: number[] = [];
		await mapWithConcurrency([1, 2, 3], 10, async (value) => {
			seen.push(value);
		});

		expect(seen).toHaveLength(3);
	});

	test('returns an empty array for an empty input', async () => {
		expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
	});

	test('rejects once a worker throws, without starting the rest', async () => {
		let started = 0;

		await expect(
			mapWithConcurrency(
				Array.from({ length: 20 }, (_, index) => index),
				2,
				async (value) => {
					started += 1;
					await delay(1);
					if (value === 1) {
						throw new Error('boom');
					}
					return value;
				},
			),
		).rejects.toThrow('boom');

		expect(started).toBeLessThan(20);
	});
});
