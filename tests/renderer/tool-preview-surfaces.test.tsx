// @vitest-environment happy-dom

/**
 * The previews a tool row opens onto are one family: a command's output, a
 * traceback, and a labelled payload all sit on the app's code surface at chat
 * density with one hover-revealed copy control. These tests hold the two that
 * replaced vendored AI-Elements cards to that shape, and cover the traceback
 * parser those cards used to carry inline.
 */

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { StackTraceDiagnostic } from '../../src/renderer/components/stack-trace-diagnostic';
import { TerminalOutput } from '../../src/renderer/components/terminal-output';
import { parseStackTrace } from '../../src/renderer/lib/agent-timeline';
import { renderWithProviders, stubClipboard } from './support/dom';

const TRACE = [
	'TypeError: cannot read length of undefined',
	'    at loadWorkspace (/repo/src/main/workspace.ts:42:17)',
	'    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
	'    at Module._compile (/repo/node_modules/pkg/index.js:7:1)',
].join('\n');

afterEach(() => {
	vi.restoreAllMocks();
});

describe('traceback parsing', () => {
	test('splits the error line from its frames', () => {
		const parsed = parseStackTrace(TRACE);

		expect(parsed.errorType).toBe('TypeError');
		expect(parsed.errorMessage).toBe('cannot read length of undefined');
		expect(parsed.frames).toHaveLength(3);
		expect(parsed.frames[0].functionName).toBe('loadWorkspace');
		expect(parsed.frames[0].filePath).toBe('/repo/src/main/workspace.ts');
		expect(parsed.frames[0].lineNumber).toBe(42);
		expect(parsed.frames[0].columnNumber).toBe(17);
	});

	test('flags runtime and dependency frames as internal', () => {
		const [own, nodeInternal, dependency] = parseStackTrace(TRACE).frames;

		expect(own.isInternal).toBe(false);
		expect(nodeInternal.isInternal).toBe(true);
		expect(dependency.isInternal).toBe(true);
	});

	test('treats a payload with no frames as a bare message', () => {
		const parsed = parseStackTrace('something went wrong');

		expect(parsed.errorType).toBeNull();
		expect(parsed.errorMessage).toBe('something went wrong');
		expect(parsed.frames).toEqual([]);
	});
});

describe('traceback preview', () => {
	test('leads with the error line and keeps only the app-owned frames', () => {
		const { container } = renderWithProviders(
			<StackTraceDiagnostic trace={TRACE} />,
		);

		expect(screen.getByText('TypeError:')).toBeTruthy();
		expect(container.textContent).toContain(
			'/repo/src/main/workspace.ts:42:17',
		);
		expect(container.textContent).not.toContain('node:internal');
		expect(container.textContent).not.toContain('node_modules');
	}, 20000);

	test('sits on the app code surface rather than its own card', () => {
		const { container } = renderWithProviders(
			<StackTraceDiagnostic trace={TRACE} />,
		);
		const surface = container.querySelector('.bg-code');

		expect(surface).not.toBeNull();
		expect(surface?.getAttribute('class')).toContain('border-code-border');
	});

	test('copies the trace verbatim', async () => {
		const written = stubClipboard();
		renderWithProviders(<StackTraceDiagnostic trace={TRACE} />);

		fireEvent.click(screen.getByLabelText('Copy output'));

		await waitFor(() => expect(written).toHaveLength(1));
		expect(written[0].text).toBe(TRACE);
	});

	test('says so when a traceback carries no frames', () => {
		renderWithProviders(<StackTraceDiagnostic trace='Error: no frames' />);

		expect(screen.getByText('No stack frames')).toBeTruthy();
	});
});

describe('terminal output preview', () => {
	const ANSI = `${String.fromCharCode(27)}[31mfailed${String.fromCharCode(27)}[0m to build`;

	test('renders the output on the app code surface with no title bar', () => {
		const { container } = renderWithProviders(
			<TerminalOutput text='npm run build' />,
		);
		const surface = container.querySelector('.bg-code');

		expect(surface).not.toBeNull();
		expect(container.textContent).toBe('npm run build');
	});

	test('keeps the ANSI colours the command emitted', () => {
		const { container } = renderWithProviders(<TerminalOutput text={ANSI} />);

		expect(container.textContent).toBe('failed to build');
		expect(container.querySelectorAll('span[style*="color"]').length).toBe(1);
	});

	test('marks a command that is still running with a cursor', () => {
		const { container } = renderWithProviders(
			<TerminalOutput isStreaming text='npm run build' />,
		);

		expect(container.querySelectorAll('.animate-pulse')).toHaveLength(1);
	});

	test('draws no cursor once the command has finished', () => {
		const { container } = renderWithProviders(
			<TerminalOutput text='npm run build' />,
		);

		expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
	});

	test('copies the output including its escapes', async () => {
		const written = stubClipboard();
		renderWithProviders(<TerminalOutput text={ANSI} />);

		fireEvent.click(screen.getByLabelText('Copy output'));

		await waitFor(() => expect(written).toHaveLength(1));
		expect(written[0].text).toBe(ANSI);
	});
});
