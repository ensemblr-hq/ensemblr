import { describe, expect, it } from 'vitest';

import { createLinearAssetCache } from '@/main/linear/linear-asset-cache';

const asset = (bytes: number, contentType = 'image/png') => ({
	body: new ArrayBuffer(bytes),
	contentType,
});

describe('createLinearAssetCache', () => {
	it('returns what it was given', () => {
		const cache = createLinearAssetCache();

		cache.set('a', asset(4, 'image/gif'));

		expect(cache.get('a')?.contentType).toBe('image/gif');
		expect(cache.get('missing')).toBeNull();
	});

	it('evicts by total bytes rather than by entry count', () => {
		const cache = createLinearAssetCache({ maxBytes: 10 });

		cache.set('a', asset(6));
		cache.set('b', asset(6));

		expect(cache.get('a')).toBeNull();
		expect(cache.get('b')).not.toBeNull();
	});

	it('keeps the entry that was read most recently', () => {
		const cache = createLinearAssetCache({ maxBytes: 10 });

		cache.set('a', asset(4));
		cache.set('b', asset(4));
		cache.get('a');
		cache.set('c', asset(4));

		expect(cache.get('a')).not.toBeNull();
		expect(cache.get('b')).toBeNull();
	});

	it('replaces an entry without double-counting its bytes', () => {
		const cache = createLinearAssetCache({ maxBytes: 10 });

		cache.set('a', asset(6));
		cache.set('a', asset(6));
		cache.set('b', asset(4));

		expect(cache.get('a')).not.toBeNull();
		expect(cache.get('b')).not.toBeNull();
	});

	it('declines an asset larger than the whole cache', () => {
		const cache = createLinearAssetCache({ maxBytes: 10 });

		cache.set('a', asset(4));
		cache.set('big', asset(20));

		expect(cache.get('big')).toBeNull();
		expect(cache.get('a')).not.toBeNull();
	});

	it('clears only the entries a predicate matches', () => {
		const cache = createLinearAssetCache({ maxBytes: 10 });

		cache.set('one:a', asset(4));
		cache.set('two:b', asset(4));
		cache.clear((key) => key.startsWith('one:'));

		expect(cache.get('one:a')).toBeNull();
		expect(cache.get('two:b')).not.toBeNull();
	});

	it('gives the cleared bytes back rather than leaking the ceiling', () => {
		const cache = createLinearAssetCache({ maxBytes: 10 });

		cache.set('a', asset(8));
		cache.clear();
		cache.set('b', asset(8));
		cache.set('c', asset(2));

		expect(cache.get('a')).toBeNull();
		expect(cache.get('b')).not.toBeNull();
		expect(cache.get('c')).not.toBeNull();
	});
});
