import { describe, expect, test } from 'vitest';
import { presentToolCall } from '../../src/renderer/lib/agent-timeline/tool-presentation';
import { glyphForToolName } from '../../src/renderer/lib/agent-timeline/tool-presenters';
import { dynamicToolCall as call } from './support/tool-presentation';

describe('Pi MCP adapter tool presentation', () => {
	test.each(['mcp', 'mcpScript', 'mcp__fallow'])(
		'%s has an MCP presenter',
		(name) => {
			const presentation = presentToolCall(call(name, {}, { text: '{}' }));

			expect(presentation.title).not.toBe(name);
			expect(glyphForToolName(name)).toBe('network');
		},
	);

	test.each([
		{
			args: {},
			preview: null,
			title: 'MCP status',
		},
		{
			args: { connect: 'linear' },
			preview: 'linear',
			title: 'Connect MCP server',
		},
		{
			args: { describe: 'linear/create_issue' },
			preview: 'linear/create_issue',
			title: 'Describe MCP tool',
		},
		{
			args: { instructions: 'linear' },
			preview: 'linear',
			title: 'Read MCP instructions',
		},
		{
			args: { search: 'create issue', server: 'linear' },
			preview: 'create issue · linear',
			title: 'Search MCP tools',
		},
		{
			args: { server: 'linear' },
			preview: 'linear',
			title: 'List MCP tools',
		},
		{
			args: { action: 'auth-start', server: 'linear' },
			preview: 'linear',
			title: 'Start MCP sign-in',
		},
		{
			args: { action: 'auth-complete', server: 'linear' },
			preview: 'linear',
			title: 'Complete MCP sign-in',
		},
		{
			args: { action: 'ui-messages' },
			preview: null,
			title: 'Read MCP UI messages',
		},
	] as const)(
		'presents gateway action as $title',
		({ args, preview, title }) => {
			const presentation = presentToolCall(
				call('mcp', args, { text: '{"ok":true}' }),
			);

			expect(presentation).toMatchObject({
				badge: null,
				body: { kind: 'code' },
				glyph: 'network',
				title,
			});
			expect(presentation.preview?.text ?? null).toBe(preview);
			expect(presentation.body.kind).not.toBe('labeled');
		},
	);

	test('presents a single gateway call by server and tool', () => {
		const presentation = presentToolCall(
			call(
				'mcp',
				{
					args: { issueId: 'ENG-42' },
					server: 'linear',
					tool: 'get_issue',
				},
				{ text: '{"identifier":"ENG-42"}' },
			),
		);

		expect(presentation).toMatchObject({
			glyph: 'network',
			preview: { font: 'mono', text: 'linear/get_issue' },
			title: 'Call MCP tool',
		});
		expect(presentation.body.kind).toBe('code');
	});

	test('presents a namespace proxy by server and underlying tool', () => {
		const presentation = presentToolCall(
			call(
				'mcp__fallow',
				{ args: { query: 'unused code' }, tool: 'audit' },
				{
					details: { mode: 'call', server: 'fallow', tool: 'audit' },
					text: '{"findings":[]}',
				},
			),
		);

		expect(presentation).toMatchObject({
			glyph: 'network',
			preview: { font: 'mono', text: 'fallow/audit' },
			title: 'Call MCP tool',
		});
		expect(presentation.body.kind).not.toBe('labeled');
	});

	test('leaves Claude Code MCP wire names on the auditable generic path', () => {
		const presentation = presentToolCall(
			call(
				'mcp__postgres__run_query',
				{ query: 'select 1' },
				{ text: '{"rows":[{"value":1}]}' },
			),
		);

		expect(presentation).toMatchObject({
			body: {
				kind: 'labeled',
				sections: [
					{ label: 'Input:', text: '{\n  "query": "select 1"\n}' },
					{ label: 'Output:', text: '{"rows":[{"value":1}]}' },
				],
			},
			glyph: 'wrench',
			preview: null,
			title: 'mcp__postgres__run_query',
		});
	});

	test('recognizes a dynamically registered direct MCP tool from result metadata', () => {
		const presentation = presentToolCall(
			call(
				'linear_get_issue',
				{ issueId: 'ENG-42' },
				{
					details: { server: 'linear', tool: 'get_issue' },
					text: '{"identifier":"ENG-42"}',
				},
			),
		);

		expect(presentation).toMatchObject({
			glyph: 'network',
			preview: { font: 'mono', text: 'linear/get_issue' },
			title: 'Call MCP tool',
		});
		expect(presentation.body.kind).toBe('code');
	});

	test.each([
		{
			details: { error: 'not_initialized' },
			preview: 'linear_get_issue',
		},
		{
			details: { error: 'server_unavailable', server: 'linear' },
			preview: 'linear/linear_get_issue',
		},
	] as const)(
		'identifies a direct MCP failure without complete target metadata',
		({ details, preview }) => {
			const presentation = presentToolCall(
				call(
					'linear_get_issue',
					{ issueId: 'ENG-42' },
					{ details, text: 'MCP not initialized' },
				),
			);

			expect(presentation).toMatchObject({
				body: { kind: 'error', text: 'MCP not initialized' },
				glyph: 'network',
				preview: { font: 'mono', text: preview },
				title: 'Call MCP tool',
				tone: 'destructive',
			});
		},
	);

	test('presents a dynamically registered MCP resource by URI', () => {
		const presentation = presentToolCall(
			call(
				'figma_read_design_tokens',
				{},
				{
					details: {
						resourceUri: 'figma://design/tokens',
						server: 'figma',
					},
					text: '{"tokens":[]}',
				},
			),
		);

		expect(presentation).toMatchObject({
			glyph: 'network',
			preview: { font: 'mono', text: 'figma/figma://design/tokens' },
			title: 'Call MCP tool',
		});
	});

	test('keeps MCP script source and output separately auditable', () => {
		const presentation = presentToolCall(
			call(
				'mcpScript',
				{
					code: 'const issues = await tools.linear_list_issues({});\nemit(issues);',
				},
				{ text: '[{"identifier":"ENG-42"}]' },
			),
		);

		expect(presentation).toMatchObject({
			body: {
				kind: 'labeled',
				sections: [
					{ label: 'Script:', muted: true },
					{ label: 'Output:', muted: false },
				],
			},
			glyph: 'network',
			preview: {
				font: 'mono',
				text: 'const issues = await tools.linear_list_issues({});',
			},
			title: 'Run MCP script',
		});
	});

	test('keeps failed MCP script source and output separately auditable', () => {
		const code =
			'const issues = await tools.linear_list_issues({});\nthrow new Error("boom");';
		const presentation = presentToolCall(
			call(
				'mcpScript',
				{ code },
				{
					details: { error: 'script_error', message: 'boom', mode: 'script' },
					text: 'boom',
				},
			),
		);

		expect(presentation).toMatchObject({
			body: {
				kind: 'labeled',
				sections: [
					{ label: 'Script:', muted: true, text: code },
					{ label: 'Output:', muted: false, text: 'boom' },
				],
			},
			tone: 'destructive',
		});
	});

	test('surfaces adapter error details as a failed row', () => {
		const presentation = presentToolCall(
			call(
				'mcp',
				{ connect: 'linear' },
				{
					details: { error: 'not_initialized', mode: 'connect' },
					text: 'MCP not initialized',
				},
			),
		);

		expect(presentation).toMatchObject({
			body: { kind: 'error', text: 'MCP not initialized' },
			tone: 'destructive',
		});
	});
});
