import { expect, test } from 'vitest';

import {
	scrollbackMbToBytes,
	scrollbackMbToLines,
} from '../../src/shared/terminal/scrollback.ts';

test('scrollbackMbToBytes converts megabytes to a byte limit', () => {
	expect(scrollbackMbToBytes(1)).toBe(1024 * 1024);
	expect(scrollbackMbToBytes(10)).toBe(10 * 1024 * 1024);
});

test('scrollbackMbToBytes clamps to at least one megabyte', () => {
	expect(scrollbackMbToBytes(0)).toBe(1024 * 1024);
	expect(scrollbackMbToBytes(-5)).toBe(1024 * 1024);
});

test('scrollbackMbToLines scales with megabytes and stays positive', () => {
	expect(scrollbackMbToLines(1)).toBeGreaterThan(0);
	expect(scrollbackMbToLines(10)).toBe(scrollbackMbToLines(1) * 10);
});
