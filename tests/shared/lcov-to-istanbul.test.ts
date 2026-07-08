import { expect, test } from 'bun:test';

import { convertLcov, parseRecord } from '../../scripts/lcov-to-istanbul.mjs';

const SAMPLE = `TN:
SF:src/foo.ts
FN:10,foo
FNDA:3,foo
DA:10,3
DA:11,0
BRDA:10,0,0,3
BRDA:10,0,1,-
end_of_record
`;

test('parseRecord builds a statementMap and hit counts from DA rows', () => {
	const entry = parseRecord(SAMPLE);
	expect(entry).not.toBeNull();
	expect(Object.keys(entry?.statementMap ?? {}).length).toBe(2);
	expect(entry?.s[0]).toBe(3);
	expect(entry?.s[1]).toBe(0);
	expect(entry?.statementMap[0]).toEqual({
		end: { column: 0, line: 10 },
		start: { column: 0, line: 10 },
	});
});

test('parseRecord builds an fnMap and function hits from FN/FNDA rows', () => {
	const entry = parseRecord(SAMPLE);
	expect(entry?.fnMap[0]?.name).toBe('foo');
	expect(entry?.fnMap[0]?.line).toBe(10);
	expect(entry?.f[0]).toBe(3);
});

test('parseRecord maps BRDA branch counts and treats "-" as zero', () => {
	const entry = parseRecord(SAMPLE);
	expect(entry?.b[0]).toEqual([3]);
	expect(entry?.b[1]).toEqual([0]);
});

test('parseRecord returns null for a block without an SF path', () => {
	expect(parseRecord('TN:\nLF:0\nLH:0')).toBeNull();
});

test('convertLcov keys files by their absolute resolved path', () => {
	const coverage = convertLcov(SAMPLE);
	const keys = Object.keys(coverage);
	expect(keys.length).toBe(1);
	expect(keys[0]?.endsWith('/src/foo.ts')).toBe(true);
	expect(coverage[keys[0] ?? '']?.path).toBe(keys[0]);
});

test('convertLcov skips trailing empty records', () => {
	const coverage = convertLcov(`${SAMPLE}\n\n`);
	expect(Object.keys(coverage).length).toBe(1);
});
