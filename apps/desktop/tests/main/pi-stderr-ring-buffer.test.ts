import { describe, expect, test } from 'vitest';

import { createRingBuffer } from '../../src/main/pi-agent/cli-rpc/ring-buffer.ts';

describe('createRingBuffer', () => {
	test('retains everything while under the cap', () => {
		const ring = createRingBuffer(32);
		ring.write(Buffer.from('abc'));
		ring.write(Buffer.from('def'));

		expect(ring.snapshot()).toBe('abcdef');
	});

	test('retains only the most recent bytes once over the cap', () => {
		const ring = createRingBuffer(4);
		ring.write(Buffer.from('abcdef'));
		ring.write(Buffer.from('gh'));

		expect(ring.snapshot()).toBe('efgh');
	});

	test('ignores an empty chunk', () => {
		const ring = createRingBuffer(8);
		ring.write(Buffer.alloc(0));
		ring.write(Buffer.from('ab'));

		expect(ring.snapshot()).toBe('ab');
	});

	test('repeated snapshots read the same bytes', () => {
		const ring = createRingBuffer(4);
		ring.write(Buffer.from('abcdef'));

		expect(ring.snapshot()).toBe('cdef');
		expect(ring.snapshot()).toBe('cdef');
		ring.write(Buffer.from('gh'));
		expect(ring.snapshot()).toBe('efgh');
	});

	// Every stderr chunk used to be concatenated against the whole retained
	// buffer, so a chatty child paid a 64 KiB copy per progress line.
	test('writes in amortized constant time at the cap', () => {
		const maxBytes = 64 * 1024;
		const ring = createRingBuffer(maxBytes);
		const chunk = Buffer.from('x'.repeat(64));
		for (let index = 0; index < maxBytes / 64; index += 1) {
			ring.write(chunk);
		}

		const startedAt = process.hrtime.bigint();
		for (let index = 0; index < 50_000; index += 1) {
			ring.write(chunk);
		}
		const perWriteNs = Number(process.hrtime.bigint() - startedAt) / 50_000;

		expect(ring.snapshot()).toHaveLength(maxBytes);
		expect(perWriteNs).toBeLessThan(1_000);
	});
});
