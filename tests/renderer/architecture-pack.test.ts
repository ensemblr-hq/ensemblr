import { describe, expect, it } from 'vitest';

import {
	type PackItem,
	packCluster,
} from '../../src/renderer/lib/architecture-diagram/pack';

/**
 * Ids the schema's alphabet permits that a Danish collation orders differently
 * from every other locale — it sorts uppercase ahead of lowercase at the
 * tertiary level, so `A-b` lands before `a-b` and `A1` before `a1`.
 */
const DIVERGENT_IDS = ['a_b', 'a-b', 'A-b', 'a1', 'A1', 'ab', 'aB'] as const;

const sameSize = (id: string): PackItem => ({
	height: 76,
	id,
	rank: 0,
	width: 168,
});

describe('packCluster orders ties without consulting a locale', () => {
	it('breaks an identical rank and size on code unit, not collation', () => {
		const packed = packCluster(DIVERGENT_IDS.map(sameSize));

		expect(packed.placements.map((placement) => placement.id)).toEqual([
			'A-b',
			'A1',
			'a-b',
			'a1',
			'aB',
			'a_b',
			'ab',
		]);
	});

	it('does not follow the host ICU default, which a Danish host diverges from', () => {
		const packed = packCluster(DIVERGENT_IDS.map(sameSize));
		const byCollation = [...DIVERGENT_IDS].sort((left, right) =>
			left.localeCompare(right, 'da-DK'),
		);

		expect(packed.placements.map((placement) => placement.id)).not.toEqual(
			byCollation,
		);
	});

	it('lays the same items out on the same pixels however they arrive', () => {
		const forwards = packCluster(DIVERGENT_IDS.map(sameSize));
		const backwards = packCluster([...DIVERGENT_IDS].reverse().map(sameSize));

		expect(backwards.placements).toEqual(forwards.placements);
		expect(backwards.width).toBe(forwards.width);
		expect(backwards.height).toBe(forwards.height);
	});

	it('still puts rank ahead of the id tiebreak', () => {
		const packed = packCluster([
			{ ...sameSize('aaa'), rank: 1 },
			{ ...sameSize('zzz'), rank: 0 },
		]);

		expect(packed.placements[0]?.id).toBe('zzz');
	});

	it('still puts the taller box ahead of the id tiebreak', () => {
		const packed = packCluster([
			{ ...sameSize('aaa'), height: 40 },
			{ ...sameSize('zzz'), height: 200 },
		]);

		expect(packed.placements[0]?.id).toBe('zzz');
	});
});

describe('packCluster: an empty cluster', () => {
	it('collapses to nothing rather than to NaN', () => {
		const packed = packCluster([]);

		expect(packed).toEqual({ height: 0, placements: [], width: 0 });
	});
});

describe('packCluster: no two boxes overlap', () => {
	it('leaves clear space between every pair it places', () => {
		const packed = packCluster(
			Array.from({ length: 12 }, (_, index) => sameSize(`n${index}`)),
		);

		for (const [index, box] of packed.placements.entries()) {
			for (const other of packed.placements.slice(index + 1)) {
				const overlaps =
					box.x < other.x + other.width &&
					other.x < box.x + box.width &&
					box.y < other.y + other.height &&
					other.y < box.y + box.height;
				expect(overlaps).toBe(false);
			}
		}
	});
});
