import { describe, expect, test } from 'vitest';

import { presentToolCall } from '../../src/renderer/lib/agent-timeline/tool-presentation';
import { dynamicToolCall as call } from './support/tool-presentation';

describe('context-mode tool presentation', () => {
	test('presents execution without repeating escaped input', () => {
		const code = "console.log('focused result')";
		const presentation = presentToolCall(
			call(
				'ctx_execute',
				{
					code,
					intent: 'failing renderer tests',
					language: 'javascript',
					timeout: 120_000,
				},
				{
					text: `\`\`\`javascript\n${code}\n\`\`\`\n\nExit code: 1\n\nstdout:\nfocused result`,
				},
			),
		);

		expect(presentation).toMatchObject({
			badge: null,
			body: {
				kind: 'labeled',
				sections: [
					{ label: 'Code:', muted: true, text: code },
					{
						label: 'Output:',
						muted: false,
						text: 'Exit code: 1\n\nstdout:\nfocused result',
					},
				],
			},
			glyph: 'square-terminal',
			preview: { font: 'sans', text: 'failing renderer tests' },
			title: 'Run code',
		});
	});

	test.each([
		{ path: undefined, toolName: 'ctx_execute' },
		{ path: 'package.json', toolName: 'ctx_execute_file' },
	] as const)(
		'preserves embedded fences in $toolName source',
		({ path, toolName }) => {
			const code = [
				'const markdown = `before',
				'```',
				'',
				'after`;',
				'console.log(markdown);',
			].join('\n');
			const pathPrefix = path === undefined ? '' : `path=${path}\n`;
			const presentation = presentToolCall(
				call(
					toolName,
					{
						code,
						language: 'javascript',
						...(path === undefined ? {} : { path }),
					},
					{
						text: `${pathPrefix}\`\`\`javascript\n${code}\n\`\`\`\n\nfinished`,
					},
				),
			);

			expect(presentation.body).toMatchObject({
				sections: [{ text: code }, { label: 'Output:', text: 'finished' }],
			});
		},
	);

	test('presents file processing with a pinned target', () => {
		const code = 'console.log(FILE_CONTENT.length)';
		const presentation = presentToolCall(
			call(
				'ctx_execute_file',
				{
					code,
					intent: 'configuration size',
					language: 'javascript',
					path: 'package.json',
				},
				{
					text: `path=package.json\n\`\`\`javascript\n${code}\n\`\`\`\n\n15240`,
				},
			),
		);

		expect(presentation).toMatchObject({
			badge: { kind: 'file', path: 'package.json' },
			body: {
				kind: 'labeled',
				sections: [
					{ label: 'Code:', muted: true, text: code },
					{ label: 'Output:', muted: false, text: '15240' },
				],
			},
			glyph: 'square-terminal',
			preview: { font: 'sans', text: 'configuration size' },
			title: 'Process file',
		});
	});

	test('previews command batches by label while preserving the audit trail', () => {
		const presentation = presentToolCall(
			call(
				'ctx_batch_execute',
				{
					commands: [
						{ command: 'git diff --check', label: 'Diff check' },
						{ command: 'git diff --stat', label: 'Diff summary' },
					],
					queries: ['whitespace errors', 'changed files'],
				},
				{ text: '2 commands indexed\nNo whitespace errors.' },
			),
		);

		expect(presentation).toMatchObject({
			badge: null,
			body: {
				kind: 'labeled',
				sections: [
					{
						label: 'Commands:',
						muted: true,
						text: 'git diff --check\ngit diff --stat',
					},
					{
						label: 'Output:',
						muted: false,
						text: '2 commands indexed\nNo whitespace errors.',
					},
				],
			},
			glyph: 'square-terminal',
			preview: { font: 'sans', text: 'Diff check · Diff summary' },
			title: 'Run commands',
		});
	});

	test('presents context search by query instead of raw arguments', () => {
		const presentation = presentToolCall(
			call(
				'ctx_search',
				{
					queries: ['CI job status', 'failing checks'],
					source: 'current session',
				},
				{ text: 'CodeRabbit pass\nReact Doctor pass' },
			),
		);

		expect(presentation).toMatchObject({
			badge: null,
			body: {
				code: 'CodeRabbit pass\nReact Doctor pass',
				kind: 'code',
			},
			glyph: 'search',
			preview: { font: 'sans', text: 'CI job status · failing checks' },
			title: 'Search context',
		});
	});

	test('presents fetched documentation by source labels', () => {
		const presentation = presentToolCall(
			call(
				'ctx_fetch_and_index',
				{
					requests: [
						{ source: 'React docs', url: 'https://react.dev/reference' },
						{ source: 'Vite docs', url: 'https://vite.dev/guide' },
					],
				},
				{ text: 'Fetched and indexed 2 sources.' },
			),
		);

		expect(presentation).toMatchObject({
			body: { code: 'Fetched and indexed 2 sources.', kind: 'code' },
			glyph: 'network',
			preview: { font: 'sans', text: 'React docs · Vite docs' },
			title: 'Fetch and index',
		});
	});

	test.each([
		{
			expectedPreview: 'https://docs.example.com/reference',
			input: {
				url: 'https://user:password@docs.example.com/reference?token=secret#setup',
			},
		},
		{
			expectedPreview: 'https://react.dev/reference · https://vite.dev/guide/',
			input: {
				requests: [
					{ url: 'https://reader:key@react.dev/reference?signature=secret' },
					{ url: 'https://vite.dev/guide/#start' },
				],
			},
		},
	] as const)(
		'sanitizes direct and batched URL previews',
		({ expectedPreview, input }) => {
			const presentation = presentToolCall(
				call('ctx_fetch_and_index', input, { text: 'Indexed.' }),
			);

			expect(presentation.preview).toEqual({
				font: 'sans',
				text: expectedPreview,
			});
		},
	);

	test('presents local indexing with a pinned file', () => {
		const presentation = presentToolCall(
			call(
				'ctx_index',
				{ path: 'docs/architecture.md', source: 'Architecture notes' },
				{ text: 'Indexed 8 sections.' },
			),
		);

		expect(presentation).toMatchObject({
			badge: { kind: 'file', path: 'docs/architecture.md' },
			body: { code: 'Indexed 8 sections.', kind: 'code' },
			glyph: 'brain',
			preview: { font: 'sans', text: 'Architecture notes' },
			title: 'Index context',
		});
	});

	test.each([
		{
			expectedGlyph: 'stethoscope',
			expectedPreview: null,
			expectedTitle: 'Check context mode',
			input: {},
			toolName: 'ctx_doctor',
		},
		{
			expectedGlyph: 'panels-top-left',
			expectedPreview: null,
			expectedTitle: 'Open Insight',
			input: {},
			toolName: 'ctx_insight',
		},
		{
			expectedGlyph: 'square-x',
			expectedPreview: { font: 'mono', text: 'project' },
			expectedTitle: 'Purge context',
			input: { confirm: true, scope: 'project' },
			toolName: 'ctx_purge',
		},
		{
			expectedGlyph: 'brain',
			expectedPreview: null,
			expectedTitle: 'Context usage',
			input: {},
			toolName: 'ctx_stats',
		},
		{
			expectedGlyph: 'puzzle',
			expectedPreview: null,
			expectedTitle: 'Upgrade context mode',
			input: {},
			toolName: 'ctx_upgrade',
		},
	] as const)(
		'presents $toolName as focused maintenance output',
		({ expectedGlyph, expectedPreview, expectedTitle, input, toolName }) => {
			const presentation = presentToolCall(
				call(toolName, input, { text: 'Maintenance result' }),
			);

			expect(presentation).toMatchObject({
				badge: null,
				body: { code: 'Maintenance result', kind: 'code' },
				glyph: expectedGlyph,
				preview: expectedPreview,
				title: expectedTitle,
			});
		},
	);
});
