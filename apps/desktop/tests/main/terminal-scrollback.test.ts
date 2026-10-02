import { describe, expect, test } from 'vitest';

import { createScrollbackBuffer } from '../../src/main/terminal/terminal-scrollback.ts';

describe('createScrollbackBuffer', () => {
	test('retains the tail once the limit is exceeded', () => {
		const buffer = createScrollbackBuffer(8);
		buffer.append('abcd');
		buffer.append('efgh');
		buffer.append('ijkl');

		expect(buffer.read()).toBe('efghijkl');
	});

	test('trims partially through a chunk', () => {
		const buffer = createScrollbackBuffer(5);
		buffer.append('abcdef');
		buffer.append('gh');

		expect(buffer.read()).toBe('defgh');
	});

	test('ignores empty appends', () => {
		const buffer = createScrollbackBuffer(8);
		buffer.append('');
		buffer.append('ab');

		expect(buffer.read()).toBe('ab');
		expect(buffer.offsets()).toEqual({ appended: 2, dropped: 0 });
	});

	test('reports the global offsets the retained window covers', () => {
		const buffer = createScrollbackBuffer(4);
		buffer.append('abcdef');

		expect(buffer.offsets()).toEqual({ appended: 6, dropped: 2 });
		expect(buffer.read()).toBe('cdef');
	});

	test('reads the delta appended since a still-retained mark', () => {
		const buffer = createScrollbackBuffer(16);
		buffer.append('abcd');
		const mark = buffer.offsets().appended;
		buffer.append('ef');
		buffer.append('gh');

		expect(buffer.readSince(mark)).toBe('efgh');
		expect(buffer.readSince(buffer.offsets().appended)).toBe('');
	});

	test('reads a delta that starts inside a retained chunk', () => {
		const buffer = createScrollbackBuffer(16);
		buffer.append('abcdef');

		expect(buffer.readSince(2)).toBe('cdef');
	});

	test('refuses a delta whose start has already been trimmed away', () => {
		const buffer = createScrollbackBuffer(4);
		buffer.append('abcd');
		buffer.append('efgh');

		expect(buffer.readSince(0)).toBeNull();
		expect(buffer.readSince(4)).toBe('efgh');
	});

	test('appends in amortized constant time once the limit is reached', () => {
		const limit = 1_000_000;
		const chunk = 'x'.repeat(16);
		const buffer = createScrollbackBuffer(limit);
		for (let index = 0; index < limit / chunk.length; index += 1) {
			buffer.append(chunk);
		}

		const startedAt = process.hrtime.bigint();
		for (let index = 0; index < 20_000; index += 1) {
			buffer.append(chunk);
		}
		const perAppendNs = Number(process.hrtime.bigint() - startedAt) / 20_000;

		expect(buffer.read()).toHaveLength(limit);
		expect(perAppendNs).toBeLessThan(20_000);
	});
});
