import { describe, expect, test } from 'vitest';

import {
	areStringArraysEqual,
	reconcileOrderedIds,
	reconcileOrderedIdsByCanonicalSlot,
} from '../../src/renderer/lib/ordered-ids';

describe('areStringArraysEqual', () => {
	test('returns true for identical order', () => {
		expect(areStringArraysEqual(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true);
	});

	test('returns false for different order', () => {
		expect(areStringArraysEqual(['a', 'b'], ['b', 'a'])).toBe(false);
	});

	test('returns false for different length', () => {
		expect(areStringArraysEqual(['a'], ['a', 'b'])).toBe(false);
	});

	test('returns true for two empty arrays', () => {
		expect(areStringArraysEqual([], [])).toBe(true);
	});
});

describe('reconcileOrderedIds', () => {
	test('keeps the preferred order when it covers every available id', () => {
		expect(reconcileOrderedIds(['c', 'a', 'b'], ['a', 'b', 'c'])).toEqual([
			'c',
			'a',
			'b',
		]);
	});

	test('drops ids that are no longer available', () => {
		expect(reconcileOrderedIds(['a', 'gone', 'b'], ['a', 'b'])).toEqual([
			'a',
			'b',
		]);
	});

	test('drops duplicate ids, keeping the first occurrence', () => {
		expect(reconcileOrderedIds(['a', 'a', 'b'], ['a', 'b'])).toEqual([
			'a',
			'b',
		]);
	});

	test('appends available ids missing from the preferred order in canonical order', () => {
		expect(reconcileOrderedIds(['b'], ['a', 'b', 'c'])).toEqual([
			'b',
			'a',
			'c',
		]);
	});

	test('returns the canonical order when the preferred order is empty', () => {
		expect(reconcileOrderedIds([], ['a', 'b'])).toEqual(['a', 'b']);
	});
});

describe('reconcileOrderedIdsByCanonicalSlot', () => {
	test('inserts a new id after its canonical predecessor, not at the end', () => {
		expect(
			reconcileOrderedIdsByCanonicalSlot(
				['a', 'b', 'c'],
				['a', 'inserted', 'b', 'c'],
			),
		).toEqual(['a', 'inserted', 'b', 'c']);
	});

	test('honours the canonical slot even when the preferred order was dragged', () => {
		expect(
			reconcileOrderedIdsByCanonicalSlot(
				['c', 'a', 'b'],
				['a', 'inserted', 'b', 'c'],
			),
		).toEqual(['c', 'a', 'inserted', 'b']);
	});

	test('keeps consecutive new ids in canonical order behind one predecessor', () => {
		expect(
			reconcileOrderedIdsByCanonicalSlot(['a', 'b'], ['a', 'x', 'y', 'b']),
		).toEqual(['a', 'x', 'y', 'b']);
	});

	test('puts a new leading id at the front', () => {
		expect(
			reconcileOrderedIdsByCanonicalSlot(['a', 'b'], ['first', 'a', 'b']),
		).toEqual(['first', 'a', 'b']);
	});

	test('still drops ids that are no longer available', () => {
		expect(
			reconcileOrderedIdsByCanonicalSlot(['a', 'gone', 'b'], ['a', 'b']),
		).toEqual(['a', 'b']);
	});

	test('drops duplicate ids in the preferred order', () => {
		expect(
			reconcileOrderedIdsByCanonicalSlot(['b', 'b', 'a'], ['a', 'b']),
		).toEqual(['b', 'a']);
	});
});
