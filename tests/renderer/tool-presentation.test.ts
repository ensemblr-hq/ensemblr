import type { DynamicToolUIPart } from 'ai';
import { describe, expect, test } from 'vitest';

import {
	presentReasoning,
	presentToolCall,
} from '../../src/renderer/lib/pi/tool-presentation';

function call(
	toolName: string,
	input: Record<string, unknown>,
	output?: { details?: Record<string, unknown>; text: string },
): DynamicToolUIPart {
	if (output === undefined) {
		return {
			input,
			state: 'input-available',
			toolCallId: `${toolName}-1`,
			toolName,
			type: 'dynamic-tool',
		};
	}
	return {
		input,
		output: { details: output.details ?? null, text: output.text },
		state: 'output-available',
		toolCallId: `${toolName}-1`,
		toolName,
		type: 'dynamic-tool',
	};
}

const EDIT_PATCH =
	'--- src/broken.ts\n+++ src/broken.ts\n@@ -1,3 +1,3 @@\n import { a } from "./a";\n-const x = "1";\n+const x = 1;\n';

const MARKER_HEAVY_PATCH =
	'--- docs/guide.md\n+++ docs/guide.md\n@@ -1,3 +1,3 @@\n # Guide\n----\n-Run with --verbose\n++++trace\n+Run with ++trace\n';

const STACK_TRACE_ERROR =
	'TypeError: Cannot read properties of undefined\n    at resolve (/repo/src/a.ts:12:9)\n    at run (/repo/src/b.ts:44:3)';

describe('presentToolCall', () => {
	test('numbers a read body from the requested offset', () => {
		const presentation = presentToolCall(
			call('read', { offset: 25, path: 'src/app.tsx' }, { text: 'a\nb\nc\n' }),
		);

		expect(presentation.title).toBe('Read 3 lines');
		expect(presentation.badge).toMatchObject({
			kind: 'file',
			path: 'src/app.tsx',
		});
		expect(presentation.body).toMatchObject({
			kind: 'code',
			language: 'tsx',
			startLine: 26,
		});
	});

	test('renders an edit as a diff and counts its changed lines', () => {
		const presentation = presentToolCall(
			call(
				'edit',
				{ path: 'src/broken.ts' },
				{ details: { patch: EDIT_PATCH }, text: 'Replaced 1 block.' },
			),
		);

		expect(presentation.body).toMatchObject({
			kind: 'diff',
			language: 'typescript',
			patch: EDIT_PATCH,
		});
		expect(presentation.badge).toMatchObject({ additions: 1, deletions: 1 });
	});

	test('counts changed lines whose content opens with a diff marker', () => {
		const presentation = presentToolCall(
			call(
				'edit',
				{ path: 'docs/guide.md' },
				{ details: { patch: MARKER_HEAVY_PATCH }, text: 'Replaced 2 blocks.' },
			),
		);

		expect(presentation.badge).toMatchObject({ additions: 2, deletions: 2 });
	});

	test('counts written lines without the trailing newline terminator', () => {
		const presentation = presentToolCall(
			call('write', { content: 'one\ntwo\nthree\n', path: 'src/new.ts' }),
		);

		expect(presentation.badge).toMatchObject({
			additions: 3,
			deletions: null,
		});
	});

	test('falls back to the result text when an edit reports no patch', () => {
		const presentation = presentToolCall(
			call('edit', { path: 'src/a.ts' }, { text: 'Nothing to change.' }),
		);

		expect(presentation.body).toMatchObject({
			code: 'Nothing to change.',
			kind: 'code',
		});
		expect(presentation.badge).toMatchObject({
			additions: null,
			deletions: null,
		});
	});

	test('previews the shell command and keeps plain stdout off the terminal', () => {
		const presentation = presentToolCall(
			call('bash', { command: 'pwd && ls' }, { text: '/sandbox\nREADME.md' }),
		);

		expect(presentation.preview).toEqual({ font: 'mono', text: 'pwd && ls' });
		expect(presentation.body.kind).toBe('code');
	});

	test('routes ANSI-coloured output to the terminal body', () => {
		const coloured = `${String.fromCharCode(27)}[31mfail${String.fromCharCode(27)}[0m`;
		const presentation = presentToolCall(
			call('bash', { command: 'npm test' }, { text: coloured }),
		);

		expect(presentation.body).toEqual({ kind: 'terminal', text: coloured });
	});

	test('lists language-server diagnostics worst-first', () => {
		const presentation = presentToolCall(
			call(
				'lsp_diagnostics',
				{ filePath: 'src/broken.ts' },
				{
					details: {
						diagnostics: [
							{
								message: 'unused import',
								range: { start: { character: 0, line: 0 } },
								severity: 2,
								source: 'typescript',
							},
							{
								message: 'not assignable',
								range: { start: { character: 6, line: 3 } },
								severity: 1,
							},
						],
					},
					text: '2 diagnostics found.',
				},
			),
		);

		expect(presentation.title).toBe('2 diagnostics');
		expect(presentation.tone).toBe('destructive');
		expect(presentation.body).toMatchObject({
			entries: [
				{ column: 7, line: 4, message: 'not assignable', severity: 'error' },
				{ message: 'unused import', severity: 'warning', source: 'typescript' },
			],
			kind: 'diagnostics',
		});
	});

	test('gives a clean diagnostics run nothing to expand', () => {
		const presentation = presentToolCall(
			call(
				'lsp_diagnostics',
				{ filePath: 'src/ok.ts' },
				{ details: { diagnostics: [] }, text: 'No diagnostics found.' },
			),
		);

		expect(presentation.body).toEqual({ kind: 'empty' });
		expect(presentation.tone).toBe('default');
	});

	test('shows both halves of an unknown extension exchange', () => {
		const presentation = presentToolCall(
			call(
				'playwright__browser_navigate',
				{ url: 'http://localhost:5199/' },
				{ text: '### Ran Playwright code' },
			),
		);

		expect(presentation.glyph).toBe('wrench');
		expect(presentation.title).toBe('playwright__browser_navigate');
		expect(presentation.body).toMatchObject({
			kind: 'labeled',
			sections: [
				{ label: 'Input:', muted: true },
				{ label: 'Output:', muted: false, text: '### Ran Playwright code' },
			],
		});
	});

	test('marks a failed call destructive whatever tool produced it', () => {
		const presentation = presentToolCall({
			errorText: 'command not found',
			input: {},
			state: 'output-error',
			toolCallId: 'bash-1',
			toolName: 'bash',
			type: 'dynamic-tool',
		});

		expect(presentation).toMatchObject({
			body: { kind: 'error', text: 'command not found' },
			glyph: 'circle-x',
			title: 'Bash failed',
			tone: 'destructive',
		});
	});

	test('routes a failure carrying a traceback to the stack-trace body', () => {
		const presentation = presentToolCall({
			errorText: STACK_TRACE_ERROR,
			input: {},
			state: 'output-error',
			toolCallId: 'bash-2',
			toolName: 'bash',
			type: 'dynamic-tool',
		});

		expect(presentation.body).toEqual({
			kind: 'stack-trace',
			trace: STACK_TRACE_ERROR,
		});
		expect(presentation.tone).toBe('destructive');
	});

	test('holds a running call at a pending body but keeps its identity', () => {
		const presentation = presentToolCall(call('read', { path: 'src/app.tsx' }));

		expect(presentation.body).toEqual({ kind: 'pending' });
		expect(presentation.badge).toMatchObject({ path: 'src/app.tsx' });
	});

	test('reads a legacy plain-string output as text with no details', () => {
		const presentation = presentToolCall({
			input: { command: 'ls' },
			output: 'README.md',
			state: 'output-available',
			toolCallId: 'bash-legacy',
			toolName: 'bash',
			type: 'dynamic-tool',
		});

		expect(presentation.body).toMatchObject({
			code: 'README.md',
			kind: 'code',
		});
	});
});

describe('presentReasoning', () => {
	test('renders reasoning as markdown with a prose preview', () => {
		const presentation = presentReasoning('I should **check** the config.');

		expect(presentation).toMatchObject({
			body: { kind: 'markdown', text: 'I should **check** the config.' },
			glyph: 'brain',
			preview: { font: 'sans' },
			title: 'Thinking',
		});
	});
});
