import { describe, expect, test } from 'vitest';

import {
	classifyToolOutput,
	looksLikeStackTrace,
	stringifyToolValue,
} from '../../src/renderer/lib/pi/tool-output-classifier';

describe('classifyToolOutput', () => {
	test('classifies Node stack traces as stack-trace', () => {
		const trace =
			'TypeError: thing\n    at run (/app/index.ts:42:7)\n    at main (/app/index.ts:9:3)';
		const result = classifyToolOutput('bash', trace);
		expect(result.kind).toBe('stack-trace');
		expect(result.text).toBe(trace);
	});

	test('classifies bash tool output as terminal regardless of body', () => {
		const result = classifyToolOutput('bash', 'README.md\npackage.json');
		expect(result.kind).toBe('terminal');
	});

	test('classifies ANSI-escaped output as terminal even when tool name is neutral', () => {
		const ansi = `[31mError[0m: thing`;
		const result = classifyToolOutput('runner', ansi);
		expect(result.kind).toBe('terminal');
	});

	test('classifies fenced markdown blocks as code', () => {
		const fenced = '```ts\nconst x = 1\n```';
		const result = classifyToolOutput('search', fenced);
		expect(result.kind).toBe('code');
	});

	test('classifies git diffs as code with diff language', () => {
		const diff =
			'diff --git a/foo.ts b/foo.ts\nindex 1..2 100644\n--- a/foo.ts\n+++ b/foo.ts';
		const result = classifyToolOutput('patcher', diff);
		expect(result.kind).toBe('code');
		expect(result.language).toBe('diff');
	});

	test('does NOT classify plain English with a single code keyword as code', () => {
		const plain = 'The function ran successfully.';
		const result = classifyToolOutput('explain', plain);
		expect(result.kind).not.toBe('code');
	});

	test('does classify text with three or more code keywords as code', () => {
		const code =
			'import foo from "bar"\nexport function baz() { return await thing() }';
		const result = classifyToolOutput('explain', code);
		expect(result.kind).toBe('code');
	});

	test('classifies path-tree-shaped output as path-tree under a neutral tool name', () => {
		const tree = 'src/\n  components/\n  lib/utils.ts';
		const result = classifyToolOutput('inspector', tree);
		expect(result.kind).toBe('path-tree');
	});

	test('terminal name heuristic still wins over path-tree shape', () => {
		const tree = 'src/\n  components/\n  lib/utils.ts';
		const result = classifyToolOutput('bash', tree);
		expect(result.kind).toBe('terminal');
	});

	test('classifies object payloads (non-string) as json', () => {
		const result = classifyToolOutput('lookup', { a: 1 });
		expect(result.kind).toBe('json');
		expect(result.text).toContain('"a": 1');
	});

	test('classifies plain string output as text', () => {
		const result = classifyToolOutput('summarize', 'all good');
		expect(result.kind).toBe('text');
	});
});

describe('looksLikeStackTrace', () => {
	test('matches Node-style at-line frames', () => {
		expect(looksLikeStackTrace('Error: x\n    at fn (/a.ts:1:2)')).toBe(true);
	});

	test('matches bare "FooError:" prefix', () => {
		expect(looksLikeStackTrace('RangeError: oops')).toBe(true);
	});

	test('does not match unrelated prose', () => {
		expect(looksLikeStackTrace('Everything is fine')).toBe(false);
	});
});

describe('stringifyToolValue', () => {
	test('returns strings unchanged', () => {
		expect(stringifyToolValue('hello')).toBe('hello');
	});

	test('serializes objects as pretty JSON', () => {
		expect(stringifyToolValue({ a: 1 })).toContain('"a": 1');
	});

	test('falls back to String() when JSON serialization fails', () => {
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		const result = stringifyToolValue(cycle);
		expect(typeof result).toBe('string');
	});
});
