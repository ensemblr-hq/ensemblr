import type { DynamicToolUIPart } from 'ai';
import { describe, expect, test } from 'vitest';
import { presentToolCall } from '../../src/renderer/lib/agent-timeline/tool-presentation';
import { glyphForToolName } from '../../src/renderer/lib/agent-timeline/tool-presenters';
import type { ToolPresentationV1 } from '../../src/shared/tool-presentation';
import { dynamicToolCall as call } from './support/tool-presentation';

function extensionCall(
	toolName: string,
	presentation: ToolPresentationV1,
): DynamicToolUIPart & { toolPresentation: ToolPresentationV1 } {
	return {
		...call(toolName, { query: 'react' }, { text: 'raw output' }),
		toolPresentation: presentation,
	};
}

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

	test('lets a valid extension descriptor override a third-party presenter', () => {
		const presentation = presentToolCall(
			extensionCall('lsp_diagnostics', {
				body: { kind: 'markdown', text: '**Extension result**' },
				glyph: 'search',
				title: { en: 'Custom diagnostics', ru: 'Своя диагностика' },
				version: 1,
			}),
		);

		expect(presentation).toMatchObject({
			body: { kind: 'markdown', text: '**Extension result**' },
			extensionOwned: true,
			glyph: 'search',
			rawIO: { toolName: 'lsp_diagnostics' },
			title: 'Custom diagnostics',
		});
	});

	test.each(['read', 'find', 'powershell'])(
		'keeps Pi core tool %s host-owned',
		(toolName) => {
			const presentation = presentToolCall(
				extensionCall(toolName, {
					body: { kind: 'markdown', text: 'do not use this' },
					title: 'Extension core tool',
					version: 1,
				}),
			);

			expect(presentation.extensionOwned).not.toBe(true);
			expect(presentation.title).not.toBe('Extension core tool');
		},
	);

	test('uses plain text for an unknown extension code language', () => {
		const presentation = presentToolCall(
			extensionCall('vendor_search', {
				body: {
					code: 'result',
					kind: 'code',
					language: 'made-up-language',
				},
				title: 'Vendor result',
				version: 1,
			}),
		);

		expect(presentation.body).toMatchObject({ kind: 'code', language: 'text' });
	});

	test('host failure wins over a valid extension descriptor', () => {
		const failedPart: DynamicToolUIPart & {
			toolPresentation: ToolPresentationV1;
		} = {
			errorText: 'permission denied',
			input: {},
			state: 'output-error',
			toolCallId: 'failed-extension',
			toolName: 'vendor_search',
			toolPresentation: {
				body: { kind: 'markdown', text: 'friendly failure' },
				title: 'Friendly',
				version: 1,
			},
			type: 'dynamic-tool',
		};
		const presentation = presentToolCall(failedPart);

		expect(presentation).toMatchObject({
			body: { kind: 'error', text: 'permission denied' },
			tone: 'destructive',
		});
	});

	test('keeps a host permission denial ahead of custom presentation', () => {
		const deniedPart: DynamicToolUIPart & {
			toolPresentation: ToolPresentationV1;
		} = {
			approval: {
				approved: false,
				id: 'approval-1',
				reason: 'Denied by user',
			},
			input: { query: 'react' },
			state: 'output-denied',
			toolCallId: 'denied-extension',
			toolName: 'vendor_search',
			toolPresentation: {
				body: { kind: 'markdown', text: 'friendly denial' },
				title: 'Friendly',
				version: 1,
			},
			type: 'dynamic-tool',
		};
		const presentation = presentToolCall(deniedPart);

		expect(presentation).toMatchObject({
			body: { kind: 'error', text: 'Denied by user' },
			tone: 'destructive',
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
