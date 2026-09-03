// @vitest-environment happy-dom

import { fireEvent, screen, within } from '@testing-library/react';
import type { DynamicToolUIPart } from 'ai';
import { createStore, Provider } from 'jotai';
import type { ReactElement } from 'react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

// Shiki resolves asynchronously and colours nothing on the first paint. Pinning
// it to a permanent cache miss holds every code body on its raw-text fallback,
// which is the text these assertions read.
vi.mock('../../src/renderer/lib/code/highlighter', () => ({
	highlightCode: () => null,
}));

import {
	ChatReasoningCollapsible,
	ChatToolCall,
} from '../../src/renderer/components/chat-tool-call';
import {
	FilePreviewOpenerProvider,
	WorkspacePathResolverProvider,
} from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { renderWithProviders } from './support/dom';

const ESCAPE = String.fromCharCode(27);

const READ_SOURCE = [
	"const THEMES = ['light', 'dark'] as const;",
	'',
	'export function Playground() {',
	'\treturn null;',
	'}',
].join('\n');

const EDIT_PATCH = [
	'--- src/renderer/components/tool-collapsible.tsx',
	'+++ src/renderer/components/tool-collapsible.tsx',
	'@@ -20,3 +20,4 @@',
	" const CODE_THEME = 'catppuccin-mocha' as BundledTheme;",
	"-const TOOL_COMMAND = 'open the playground';",
	"-const TOOL_OUTPUT = 'Bash completed with no output';",
	"+const BASH_COMMAND = 'open the playground';",
	"+const BASH_OUTPUT = 'Bash completed with no output';",
	"+const READ_PATH = 'playground/playground.tsx';",
	'',
].join('\n');

const ANSI_OUTPUT = `${ESCAPE}[31mFAIL${ESCAPE}[0m tests/renderer/tool-call-bodies.test.tsx`;

const REPLACE_FAILURE = [
	'<tool_use_error>String to replace not found in file.',
	'String: <div className="flex min-w-0 flex-1 items-center gap-2"></tool_use_error>',
].join('\n');

const STACK_TRACE = [
	"TypeError: Cannot read properties of undefined (reading 'patch')",
	'    at presentEdit (/repo/src/renderer/lib/agent-timeline/tool-presentation.ts:329:32)',
	'    at presentToolCall (/repo/src/renderer/lib/agent-timeline/tool-presentation.ts:524:26)',
].join('\n');

const PLAYWRIGHT_OUTPUT = [
	'### Ran Playwright code',
	'### Page',
	'- Page Title: Ensemblr Playground',
].join('\n');

const REASONING = [
	'The **error** variant renders correctly.',
	'',
	'Next I will number the gutter from the real file offset.',
].join('\n');

function toolPart(
	toolName: string,
	input: Record<string, unknown>,
	text: string,
	details: Record<string, unknown> | null = null,
): DynamicToolUIPart {
	return {
		input,
		output: { details, text },
		state: 'output-available',
		toolCallId: `${toolName}-settled`,
		toolName,
		type: 'dynamic-tool',
	};
}

function failedPart(toolName: string, errorText: string): DynamicToolUIPart {
	return {
		errorText,
		input: {},
		state: 'output-error',
		toolCallId: `${toolName}-failed`,
		toolName,
		type: 'dynamic-tool',
	};
}

function runningPart(
	toolName: string,
	input: Record<string, unknown>,
): DynamicToolUIPart {
	return {
		input,
		state: 'input-available',
		toolCallId: `${toolName}-running`,
		toolName,
		type: 'dynamic-tool',
	};
}

function renderRow(ui: ReactElement) {
	const store = createStore();
	const withRowProviders = (node: ReactElement) => (
		<Provider store={store}>
			<WorkspacePathResolverProvider
				value={(filePath: string) => ({
					kind: filePath.includes('.') ? 'file' : 'directory',
					path: filePath,
					scope: 'workspace',
				})}
			>
				<FilePreviewOpenerProvider value={() => undefined}>
					{node}
				</FilePreviewOpenerProvider>
			</WorkspacePathResolverProvider>
		</Provider>
	);
	const result = renderWithProviders(withRowProviders(ui));
	return {
		...result,
		rerender: (next: ReactElement) => {
			result.rerender(withRowProviders(next));
		},
	};
}

function disclosureFor(title: string): HTMLElement {
	return screen.getByRole('button', { name: title });
}

function bodyOf(toggle: HTMLElement): HTMLElement | null {
	return document.getElementById(toggle.getAttribute('aria-controls') ?? '');
}

function openRow(title: string): HTMLElement {
	const toggle = disclosureFor(title);
	fireEvent.click(toggle);
	const body = bodyOf(toggle);
	if (body === null) {
		throw new Error(`Tool row "${title}" opened onto no body`);
	}
	return body;
}

describe('tool call bodies', () => {
	test('paints a read result as numbered source lines', () => {
		renderRow(
			<ChatToolCall
				part={toolPart(
					'read',
					{ offset: 525, path: 'playground/playground.tsx' },
					READ_SOURCE,
				)}
			/>,
		);

		const body = openRow('Read 5 lines');

		expect(
			within(body).getByText("const THEMES = ['light', 'dark'] as const;"),
		).toBeInTheDocument();
		expect(
			within(body).getByText('export function Playground() {'),
		).toBeInTheDocument();
		expect(within(body).getByText('526')).toBeInTheDocument();
		expect(within(body).getByText('528')).toBeInTheDocument();
	});

	test('paints an edit patch as added and removed lines matching its badge', () => {
		renderRow(
			<ChatToolCall
				part={toolPart(
					'edit',
					{ path: 'src/renderer/components/tool-collapsible.tsx' },
					'Successfully replaced 2 blocks.',
					{ firstChangedLine: 20, patch: EDIT_PATCH },
				)}
			/>,
		);

		expect(screen.getByText('+3')).toBeInTheDocument();
		expect(screen.getByText('-2')).toBeInTheDocument();

		const body = openRow('Edit');

		expect(
			within(body).getByText("const BASH_COMMAND = 'open the playground';"),
		).toBeInTheDocument();
		expect(
			within(body).getByText("const TOOL_COMMAND = 'open the playground';"),
		).toBeInTheDocument();
		expect(
			within(body).getByText(
				"const CODE_THEME = 'catppuccin-mocha' as BundledTheme;",
			),
		).toBeInTheDocument();
		expect(body.querySelectorAll('.bg-diff-addition-surface')).toHaveLength(3);
		expect(body.querySelectorAll('.bg-diff-deletion-surface')).toHaveLength(2);
	});

	test('paints language-server diagnostics worst-first with their positions', () => {
		renderRow(
			<ChatToolCall
				part={toolPart(
					'lsp_diagnostics',
					{ filePath: 'src/broken.ts' },
					'2 diagnostics found.',
					{
						diagnostics: [
							{
								message: "'classify' is declared but never read.",
								range: { start: { character: 9, line: 0 } },
								severity: 2,
								source: 'typescript',
							},
							{
								message:
									"Argument of type 'string' is not assignable to parameter of type 'number'.",
								range: { start: { character: 25, line: 3 } },
								severity: 1,
								source: 'typescript',
							},
						],
					},
				)}
			/>,
		);

		const body = openRow('2 diagnostics');

		expect(
			within(body)
				.getAllByText(/^(error|warning)$/)
				.map((label) => label.textContent),
		).toEqual(['error', 'warning']);
		expect(within(body).getByText('4:26')).toBeInTheDocument();
		expect(within(body).getByText('1:10')).toBeInTheDocument();
		expect(
			within(body).getByText(
				"Argument of type 'string' is not assignable to parameter of type 'number'.",
			),
		).toBeInTheDocument();
		expect(
			within(body).getByText("'classify' is declared but never read."),
		).toBeInTheDocument();
		expect(within(body).getAllByText('typescript')).toHaveLength(2);
	});

	test('paints ANSI shell output through the terminal rather than verbatim', () => {
		renderRow(
			<ChatToolCall
				part={toolPart('bash', { command: 'npm test' }, ANSI_OUTPUT)}
			/>,
		);

		const body = openRow('Running tests');

		expect(within(body).getByText('Terminal')).toBeInTheDocument();
		expect(within(body).getByText('FAIL')).toBeInTheDocument();
		expect(body.textContent).toContain(
			'tests/renderer/tool-call-bodies.test.tsx',
		);
		expect(body.textContent).not.toContain(ESCAPE);
	});

	test('paints a failure that is not a traceback as a flat error block', () => {
		renderRow(<ChatToolCall part={failedPart('edit', REPLACE_FAILURE)} />);

		const body = openRow('Edit failed');

		expect(
			within(body).getByText(/String to replace not found in file\./),
		).toBeInTheDocument();
		expect(body.querySelector('[aria-expanded]')).toBeNull();
	});

	test('paints a failure carrying a traceback as a collapsed stack trace', () => {
		renderRow(<ChatToolCall part={failedPart('edit', STACK_TRACE)} />);

		const body = openRow('Edit failed');
		const errorType = within(body).getByText('TypeError');
		const trace = errorType.closest('[aria-expanded]');

		expect(
			within(body).getByText(/Cannot read properties of undefined/),
		).toBeInTheDocument();
		expect(trace).toHaveAttribute('aria-expanded', 'false');
		expect(
			within(body).queryByText(
				'/repo/src/renderer/lib/agent-timeline/tool-presentation.ts:329:32',
			),
		).toBeNull();

		fireEvent.click(trace as HTMLElement);

		expect(
			within(body).getByText(
				'/repo/src/renderer/lib/agent-timeline/tool-presentation.ts:329:32',
			),
		).toBeInTheDocument();
		expect(
			within(body).getByText(
				'/repo/src/renderer/lib/agent-timeline/tool-presentation.ts:524:26',
			),
		).toBeInTheDocument();
	});

	test('paints an unknown extension call as its labelled request and reply', () => {
		renderRow(
			<ChatToolCall
				part={toolPart(
					'playwright__browser_navigate',
					{ url: 'http://localhost:5199/playground/' },
					PLAYWRIGHT_OUTPUT,
				)}
			/>,
		);

		const body = openRow('playwright__browser_navigate');

		expect(within(body).getByText('Input:')).toBeInTheDocument();
		expect(within(body).getByText('Output:')).toBeInTheDocument();
		expect(
			within(body).getByText(/"url": "http:\/\/localhost:5199\/playground\/"/),
		).toBeInTheDocument();
		expect(
			within(body).getByText(/Page Title: Ensemblr Playground/),
		).toBeInTheDocument();
	});

	test('paints a reasoning block as rendered markdown', () => {
		renderRow(<ChatReasoningCollapsible text={REASONING} />);

		const body = openRow('Thinking');

		expect(within(body).getByText('error')).toHaveAttribute(
			'data-streamdown',
			'strong',
		);
		expect(
			within(body).getByText(
				'Next I will number the gutter from the real file offset.',
			).tagName,
		).toBe('P');
		expect(body.textContent).not.toContain('**');
	});

	test('renders no row for a reasoning block with no prose', () => {
		const { container } = renderRow(<ChatReasoningCollapsible text='   ' />);

		expect(container.textContent).toBe('');
		expect(screen.queryByRole('button')).toBeNull();
	});

	test('leaves a call still in flight inert until it settles', () => {
		const { rerender } = renderRow(
			<ChatToolCall
				part={runningPart('bash', { command: 'npx tsc --noEmit' })}
			/>,
		);

		const toggle = disclosureFor('Type-checking');

		expect(toggle).toBeDisabled();
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		expect(toggle).not.toHaveAttribute('aria-controls');

		fireEvent.click(toggle);

		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		expect(bodyOf(toggle)).toBeNull();
		expect(screen.getByText('npx tsc --noEmit')).toBeInTheDocument();

		rerender(
			<ChatToolCall
				part={toolPart(
					'bash',
					{ command: 'npx tsc --noEmit' },
					'Found 0 errors.',
				)}
			/>,
		);

		const settled = disclosureFor('Type-checking');

		expect(settled).toBeEnabled();
		expect(settled).toHaveAttribute('aria-expanded', 'false');
		expect(
			within(openRow('Type-checking')).getByText('Found 0 errors.'),
		).toBeInTheDocument();
	});
});

describe('tool row disclosure', () => {
	test('toggles the body and reports it through aria-expanded', () => {
		renderRow(
			<ChatToolCall
				part={toolPart(
					'read',
					{ offset: 525, path: 'playground/playground.tsx' },
					READ_SOURCE,
				)}
			/>,
		);

		const toggle = disclosureFor('Read 5 lines');

		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		expect(bodyOf(toggle)).toBeNull();

		fireEvent.click(toggle);

		expect(toggle).toHaveAttribute('aria-expanded', 'true');
		expect(bodyOf(toggle)).toContainElement(
			screen.getByText('export function Playground() {'),
		);

		fireEvent.click(toggle);

		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		expect(bodyOf(toggle)).toBeNull();
		expect(screen.queryByText('export function Playground() {')).toBeNull();
	});

	test('swaps the collapsed preview for the body once opened', () => {
		renderRow(
			<ChatToolCall
				part={toolPart(
					'glob',
					{ pattern: 'components/**/*.tsx' },
					'src/renderer/components/tool-collapsible.tsx',
				)}
			/>,
		);

		expect(screen.getByText('components/**/*.tsx')).toBeInTheDocument();

		const body = openRow('Glob');

		expect(screen.queryByText('components/**/*.tsx')).toBeNull();
		expect(
			within(body).getByText('src/renderer/components/tool-collapsible.tsx'),
		).toBeInTheDocument();
	});

	test('leaves a row with an empty body disabled and inert', () => {
		renderRow(
			<ChatToolCall
				part={toolPart(
					'lsp_diagnostics',
					{ filePath: 'src/ok.ts' },
					'No diagnostics found.',
					{ diagnostics: [] },
				)}
			/>,
		);

		const toggle = disclosureFor('Diagnostics');

		expect(toggle).toBeDisabled();
		expect(toggle).toHaveAttribute('aria-expanded', 'false');

		fireEvent.click(toggle);

		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		expect(bodyOf(toggle)).toBeNull();
		expect(screen.getByText('No diagnostics')).toBeInTheDocument();
	});
});
