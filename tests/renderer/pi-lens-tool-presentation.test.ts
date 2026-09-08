import { describe, expect, test } from 'vitest';

import { presentToolCall } from '../../src/renderer/lib/agent-timeline/tool-presentation';
import { dynamicToolCall as call } from './support/tool-presentation';

describe('Pi Lens tool presentation', () => {
	test('presents diagnostics without repeating its path list', () => {
		const result =
			'No issues across 6 files diagnosed this session. ✓ (1 changed file omitted as stale — use mode=full to rescan)\n\nNote: paths restricts this to cached findings.';
		const presentation = presentToolCall(
			call(
				'lens_diagnostics',
				{
					mode: 'all',
					paths: ['src/renderer/first.ts', 'src/renderer/second.ts'],
				},
				{ text: result },
			),
		);

		expect(presentation).toMatchObject({
			badge: null,
			body: {
				code: result,
				kind: 'code',
				language: 'text',
				startLine: null,
			},
			glyph: 'stethoscope',
			preview: {
				font: 'sans',
				text: 'No issues across 6 files diagnosed this session. ✓ (1 changed file omitted as stale — use mode=full to rescan)',
			},
			title: 'Diagnostics',
		});
	});

	test('keeps a running single-file diagnostic scoped and identifiable', () => {
		const presentation = presentToolCall(
			call('lens_diagnostics', {
				mode: 'full',
				paths: ['src/app.tsx'],
			}),
		);

		expect(presentation).toMatchObject({
			badge: { kind: 'file', path: 'src/app.tsx' },
			body: { kind: 'pending' },
			glyph: 'stethoscope',
			preview: { font: 'mono', text: 'mode=full · 1 path' },
			title: 'Diagnostics',
		});
	});

	test('shows only the mode for an unscoped running diagnostic', () => {
		const presentation = presentToolCall(
			call('lens_diagnostics', { mode: 'all' }),
		);

		expect(presentation).toMatchObject({
			badge: null,
			body: { kind: 'pending' },
			preview: { font: 'mono', text: 'mode=all' },
		});
		expect(presentation.preview?.text).not.toContain('0 paths');
	});

	test('presents a project report as a focused project overview', () => {
		const report =
			'PROJECT REPORT (graph: fresh)\nHUBS\n  src/renderer/main.tsx';
		const presentation = presentToolCall(
			call(
				'project_report',
				{
					focus: 'tool rendering',
					limit: 8,
					view: 'compact',
				},
				{ text: report },
			),
		);

		expect(presentation).toMatchObject({
			badge: null,
			body: {
				code: report,
				kind: 'code',
				language: 'text',
				startLine: null,
			},
			glyph: 'network',
			preview: { font: 'sans', text: 'tool rendering' },
			title: 'Project overview',
		});
	});

	test('presents a module report as a file-scoped outline', () => {
		const report =
			'src/app.tsx jsts 120L — 8 symbols, 3 exported\nAPI:\n  10-24 fn App';
		const presentation = presentToolCall(
			call(
				'module_report',
				{
					focus: 'tool rendering',
					path: 'src/app.tsx',
					view: 'compact',
				},
				{
					details: { callbacks: 2, exports: 3, symbols: 8, view: 'compact' },
					text: report,
				},
			),
		);

		expect(presentation).toMatchObject({
			badge: { kind: 'file', path: 'src/app.tsx' },
			body: {
				code: report,
				kind: 'code',
				language: 'text',
				startLine: null,
			},
			glyph: 'network',
			preview: { font: 'sans', text: '8 symbols · 3 exports' },
			title: 'Module outline',
		});
	});

	test('keeps a running module report identifiable by its focus', () => {
		const presentation = presentToolCall(
			call('module_report', {
				focus: 'tool rendering',
				path: 'src/app.tsx',
			}),
		);

		expect(presentation.badge).toMatchObject({ path: 'src/app.tsx' });
		expect(presentation.body).toEqual({ kind: 'pending' });
		expect(presentation.preview).toEqual({
			font: 'sans',
			text: 'tool rendering',
		});
	});

	test('presents a symbol read as numbered source without its tool header', () => {
		const source =
			'/** Greets the user. */\nfunction greet(name: string) {\n\treturn "Hi " + name;\n}';
		const presentation = presentToolCall(
			call(
				'read_symbol',
				{ path: 'src/greet.ts', symbol: 'greet' },
				{
					details: {
						endLine: 14,
						found: true,
						kind: 'function',
						name: 'greet',
						readRecorded: true,
						startLine: 11,
					},
					text: `function greet  greet.ts:11-14\n\n${source}`,
				},
			),
		);

		expect(presentation).toMatchObject({
			badge: { kind: 'file', path: 'src/greet.ts' },
			body: {
				code: source,
				kind: 'code',
				language: 'typescript',
				startLine: 11,
			},
			glyph: 'file-text',
			preview: { font: 'mono', text: 'greet · 11–14' },
			title: 'Read symbol',
		});
	});

	test('supports persisted symbol payloads without readRecorded metadata', () => {
		const source = 'function greet() { return "hi"; }';
		const presentation = presentToolCall(
			call(
				'read_symbol',
				{ path: 'src/greet.ts', symbol: 'greet' },
				{
					details: {
						endLine: 8,
						found: true,
						name: 'greet',
						startLine: 8,
					},
					text: `function greet  greet.ts:8-8\n\n${source}`,
				},
			),
		);

		expect(presentation.body).toMatchObject({
			code: source,
			kind: 'code',
			startLine: 8,
		});
		expect(presentation.preview?.text).toBe('greet · 8–8');
	});

	test.each([
		{
			name: 'missing details',
			details: undefined,
			text: 'function greet() {}',
			expectedPreview: 'greet',
		},
		{
			name: 'a not-found payload',
			details: { found: false },
			text: 'Symbol "greet" not found in greet.ts.',
			expectedPreview: 'greet',
		},
		{
			name: 'failed read coverage recording',
			details: {
				endLine: 8,
				found: true,
				name: 'greet',
				readRecorded: false,
				startLine: 8,
			},
			text: 'function greet  greet.ts:8-8\n\nWarning: read coverage recording failed.\n\nfunction greet() {}',
			expectedPreview: 'greet · 8–8',
		},
		{
			name: 'a missing source separator',
			details: {
				endLine: 8,
				found: true,
				name: 'greet',
				readRecorded: true,
				startLine: 8,
			},
			text: 'function greet() {}',
			expectedPreview: 'greet · 8–8',
		},
	])('preserves raw source for $name', ({ details, expectedPreview, text }) => {
		const presentation = presentToolCall(
			call(
				'read_symbol',
				{ path: 'src/greet.ts', symbol: 'greet' },
				{ details, text },
			),
		);

		expect(presentation.body).toMatchObject({
			code: text,
			kind: 'code',
			startLine: null,
		});
		expect(presentation.preview?.text).toBe(expectedPreview);
	});

	test('keeps an empty symbol payload collapsed', () => {
		const presentation = presentToolCall(
			call(
				'read_symbol',
				{ path: 'src/greet.ts', symbol: 'greet' },
				{
					details: {
						endLine: 8,
						found: true,
						name: 'greet',
						readRecorded: true,
						startLine: 8,
					},
					text: '',
				},
			),
		);

		expect(presentation.body).toEqual({ kind: 'empty' });
		expect(presentation.preview?.text).toBe('greet · 8–8');
	});

	test.each([
		{ expectedKind: 'folder', scope: 'tests/' },
		{ expectedKind: 'file', scope: 'tests/renderer/models.test.ts' },
	] as const)(
		'infers $expectedKind badge kind for $scope symbol-search scope',
		({ expectedKind, scope }) => {
			const result = `Top file for "agent models":\n  ${scope}`;
			const presentation = presentToolCall(
				call(
					'symbol_search',
					{ limit: 20, paths: [scope], query: 'agent models' },
					{ text: result },
				),
			);

			expect(presentation).toMatchObject({
				badge: { kind: expectedKind, path: scope },
				body: {
					code: result,
					kind: 'code',
					language: 'text',
					startLine: null,
				},
				glyph: 'search',
				preview: { font: 'mono', text: 'agent models' },
				title: 'Search symbols',
			});
		},
	);
});
