import { describe, expect, test } from 'vitest';
import { presentToolCall } from '../../src/renderer/lib/agent-timeline/tool-presentation';
import { glyphForToolName } from '../../src/renderer/lib/agent-timeline/tool-presenters';
import { dynamicToolCall as call } from './support/tool-presentation';

const WEB_TOOLS = [
	'web_search',
	'source_check',
	'fetch_content',
	'get_search_content',
] as const;

const BACKGROUND_TOOLS = [
	'bg_delegate',
	'bg_result',
	'bg_run',
	'bg_run_pi_attested',
	'bg_status',
	'bg_logs',
	'bg_kill',
	'fusion_reason',
	'fusion_investigate',
	'fusion_research',
	'fusion_validate',
] as const;

describe('extension tool presentation', () => {
	test.each([...WEB_TOOLS, ...BACKGROUND_TOOLS])(
		'%s has a dedicated presenter and glyph',
		(name) => {
			const presentation = presentToolCall(call(name, {}, { text: '' }));

			expect(presentation.title).not.toBe(name);
			expect(glyphForToolName(name)).not.toBe('wrench');
		},
	);

	test('presents web search as cited markdown without echoing input JSON', () => {
		const presentation = presentToolCall(
			call(
				'web_search',
				{ queries: ['React transitions', 'React deferred values'] },
				{
					details: { queryCount: 2, totalResults: 9 },
					text: '## React transitions\n\nUse `startTransition`. [Source](https://react.dev).',
				},
			),
		);

		expect(presentation).toMatchObject({
			body: { kind: 'markdown' },
			glyph: 'search',
			preview: { font: 'sans', text: '2 queries · 9 results' },
			title: 'Search the web',
		});
	});

	test('presents fetched content by its page title and URL', () => {
		const presentation = presentToolCall(
			call(
				'fetch_content',
				{ url: 'https://example.com/guide' },
				{
					details: { title: 'Example guide', totalChars: 4200, urlCount: 1 },
					text: '# Example guide\n\nUseful content.',
				},
			),
		);

		expect(presentation).toMatchObject({
			body: { kind: 'markdown' },
			glyph: 'network',
			preview: {
				font: 'sans',
				text: 'Example guide · https://example.com/guide · 4,200 chars',
			},
			title: 'Fetch web content',
		});
	});

	test('presents a background launch by task name and id', () => {
		const presentation = presentToolCall(
			call(
				'bg_run',
				{ command: 'npm test', isAgent: false, name: 'Renderer tests' },
				{
					details: {
						task: {
							id: 'b1234',
							name: 'Renderer tests',
							outputPath: '.pi/tasks/b1234.log',
							status: 'running',
						},
					},
					text: 'Started background task Renderer tests (b1234)',
				},
			),
		);

		expect(presentation).toMatchObject({
			glyph: 'play',
			preview: { font: 'sans', text: 'Renderer tests · b1234 · running' },
			title: 'Start background task',
		});
	});

	test('renders background logs as terminal output', () => {
		const presentation = presentToolCall(
			call(
				'bg_logs',
				{ taskId: 'b1234', tail: true },
				{
					details: {
						bytesRead: 2048,
						tail: true,
						task: { id: 'b1234', name: 'Renderer tests' },
						truncated: false,
					},
					text: 'PASS tests/renderer/tool.test.ts',
				},
			),
		);

		expect(presentation).toMatchObject({
			body: { kind: 'terminal' },
			glyph: 'terminal',
			preview: { font: 'mono', text: 'Renderer tests · b1234 · 2 KB · tail' },
			title: 'Read background logs',
		});
	});

	test('presents an inline delegate result as markdown', () => {
		const presentation = presentToolCall(
			call(
				'bg_result',
				{ taskId: 'b4567' },
				{
					details: {
						answer_bytes: 612,
						delivery: 'inline',
						state: 'committed',
						task_id: 'b4567',
					},
					text: 'Delegate b4567 completed.\n\n## Findings\n\nAll good.',
				},
			),
		);

		expect(presentation).toMatchObject({
			body: { kind: 'markdown' },
			glyph: 'scroll-text',
			preview: { font: 'sans', text: 'b4567 · ready · inline · 612 B' },
			title: 'Read background result',
		});
	});
});
