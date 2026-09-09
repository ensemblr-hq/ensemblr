import { describe, expect, test } from 'vitest';
import { presentToolCall } from '../../src/renderer/lib/agent-timeline/tool-presentation';
import { glyphForToolName } from '../../src/renderer/lib/agent-timeline/tool-presenters';
import { dynamicToolCall as call } from './support/tool-presentation';

const PI_LENS_TOOLS = [
	'ast_grep_dump',
	'ast_grep_outline',
	'ast_grep_replace',
	'ast_grep_search',
	'effective_config',
	'lens_diagnostic_mark',
	'lens_diagnostics',
	'lsp_diagnostics',
	'lsp_navigation',
	'module_report',
	'pi_lens_activate_tools',
	'project_report',
	'read_enclosing',
	'read_symbol',
	'symbol_search',
] as const;

describe('Pi Lens tool presenter coverage', () => {
	test.each(PI_LENS_TOOLS)('%s has a dedicated presenter and glyph', (name) => {
		const presentation = presentToolCall(call(name, {}, { text: '' }));

		expect(presentation.title).not.toBe(name);
		expect(glyphForToolName(name)).not.toBe('wrench');
	});

	test('presents tool activation as a compact capability list', () => {
		const presentation = presentToolCall(
			call(
				'pi_lens_activate_tools',
				{ tools: ['ast_grep_search', 'lsp_navigation'] },
				{
					text: 'Activated: ast_grep_search, lsp_navigation. Available starting next turn.',
				},
			),
		);

		expect(presentation).toMatchObject({
			body: { kind: 'empty' },
			glyph: 'puzzle',
			preview: { font: 'mono', text: 'ast_grep_search · lsp_navigation' },
			title: 'Activate Pi Lens tools',
		});
	});

	test('pins a marked diagnostic to its file and line', () => {
		const presentation = presentToolCall(
			call(
				'lens_diagnostic_mark',
				{
					disposition: 'suppress',
					filePath: 'src/problem.ts',
					line: 17,
					message: 'Unsafe call',
					rule: 'security/no-unsafe-call',
				},
				{ text: 'src/problem.ts:17 suppressed.' },
			),
		);

		expect(presentation).toMatchObject({
			badge: { kind: 'file', path: 'src/problem.ts' },
			glyph: 'stethoscope',
			preview: { font: 'sans', text: 'suppress · line 17' },
			title: 'Mark diagnostic',
		});
	});

	test.each([
		{
			args: {
				lang: 'typescript',
				paths: ['src/'],
				pattern: 'console.log($MSG)',
			},
			glyph: 'search',
			name: 'ast_grep_search',
			preview: 'console.log($MSG)',
			title: 'AST search',
		},
		{
			args: {
				apply: false,
				lang: 'typescript',
				paths: ['src/app.ts'],
				pattern: 'var $X',
				rewrite: 'let $X',
			},
			glyph: 'file-pen',
			name: 'ast_grep_replace',
			preview: 'var $X → let $X · preview',
			title: 'AST replace',
		},
		{
			args: { lang: 'typescript', paths: ['src/app.ts'], view: 'expanded' },
			details: { files: 1, items: 8, syntaxOnly: true },
			glyph: 'network',
			name: 'ast_grep_outline',
			preview: '8 symbols · 1 file',
			title: 'Syntax outline',
		},
	] as const)(
		'presents $name without dumping its input bag',
		({ args, details, glyph, name, preview, title }) => {
			const presentation = presentToolCall(
				call(name, args, {
					details,
					text: '{"matches":[]}',
				}),
			);

			expect(presentation).toMatchObject({
				glyph,
				preview: { font: 'mono', text: preview },
				title,
			});
			expect(presentation.body.kind).not.toBe('labeled');
		},
	);

	test('presents an AST dump by language and source', () => {
		const presentation = presentToolCall(
			call(
				'ast_grep_dump',
				{ lang: 'typescript', source: 'const answer = 42;' },
				{
					details: { lang: 'typescript' },
					text: 'program\n  lexical_declaration',
				},
			),
		);

		expect(presentation).toMatchObject({
			glyph: 'network',
			preview: { font: 'mono', text: 'typescript · const answer = 42;' },
			title: 'AST dump',
		});
	});

	test('presents LSP navigation with its operation and source position', () => {
		const presentation = presentToolCall(
			call(
				'lsp_navigation',
				{
					line: 24,
					operation: 'references',
					path: 'src/app.ts',
					symbol: 'renderApp',
				},
				{
					details: {
						failureKind: 'success',
						operation: 'references',
						resultCount: 3,
					},
					text: '{"operation":"references","result":[1,2,3]}',
				},
			),
		);

		expect(presentation).toMatchObject({
			badge: { kind: 'file', path: 'src/app.ts' },
			glyph: 'crosshair',
			preview: { font: 'mono', text: 'references · renderApp · line 24' },
			title: 'LSP navigation',
		});
		expect(presentation.body).toMatchObject({ kind: 'code', language: 'json' });
	});

	test.each([
		{
			args: {
				apply: true,
				line: 24,
				newName: 'renderWorkspace',
				operation: 'rename',
				path: 'src/app.ts',
				symbol: 'renderApp',
			},
			preview: 'rename · renderApp → renderWorkspace · applied · line 24',
		},
		{
			args: {
				apply: false,
				newFilePath: 'src/workspace.ts',
				operation: 'rename_file',
				path: 'src/app.ts',
			},
			preview: 'rename_file · src/app.ts → src/workspace.ts · preview',
		},
		{
			args: {
				apply: true,
				command: 'typescript.organizeImports',
				operation: 'executeCommand',
			},
			preview: 'executeCommand · typescript.organizeImports · applied',
		},
	] as const)(
		'presents mutating LSP navigation as $preview',
		({ args, preview }) => {
			const presentation = presentToolCall(
				call('lsp_navigation', args, {
					details: { applied: args.apply, operation: args.operation },
					text: '{}',
				}),
			);

			expect(presentation).toMatchObject({
				preview: { font: 'mono', text: preview },
				title: 'LSP navigation',
			});
		},
	);

	test('presents an enclosing read as numbered source', () => {
		const source = 'function renderApp() {\n\treturn null;\n}';
		const presentation = presentToolCall(
			call(
				'read_enclosing',
				{ line: 25, path: 'src/app.ts' },
				{
					details: {
						endLine: 27,
						found: true,
						kind: 'function',
						name: 'renderApp',
						readRecorded: true,
						startLine: 25,
					},
					text: `function renderApp  app.ts:25-27\n\n${source}`,
				},
			),
		);

		expect(presentation).toMatchObject({
			badge: { kind: 'file', path: 'src/app.ts' },
			body: {
				code: source,
				kind: 'code',
				language: 'typescript',
				startLine: 25,
			},
			glyph: 'file-text',
			preview: { font: 'mono', text: 'renderApp · 25–27' },
			title: 'Read enclosing',
		});
	});

	test('presents effective configuration without repeating the target path', () => {
		const output =
			'effective_config src/app.ts — 3 config file(s) · 1 server(s) selected · 2 tool(s)\n\n{"documents":[]}';
		const presentation = presentToolCall(
			call(
				'effective_config',
				{ file: 'src/app.ts' },
				{
					details: {
						documents: 3,
						file: 'src/app.ts',
						selectedServers: 1,
						summary:
							'effective_config src/app.ts — 3 config file(s) · 1 server(s) selected · 2 tool(s)',
					},
					text: output,
				},
			),
		);

		expect(presentation).toMatchObject({
			badge: { kind: 'file', path: 'src/app.ts' },
			glyph: 'scroll-text',
			preview: { font: 'sans', text: '3 config files · 1 server selected' },
			title: 'Effective config',
		});
		expect(presentation.body.kind).not.toBe('labeled');
	});
});
