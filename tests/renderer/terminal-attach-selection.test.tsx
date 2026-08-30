// @vitest-environment happy-dom

/**
 * The terminal's right-click menu is the only way a selection reaches the chat,
 * and the two things that can go wrong are invisible from the markup: reading
 * the selection at the wrong moment (xterm re-selects the word under the cursor
 * on a right-click outside the selection, so anything read before its own
 * handler attaches text the click discarded), and leaving the surface unable to
 * take keystrokes once the menu closes.
 */

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, expect, test, vi } from 'vitest';

import { XtermTerminal } from '@/renderer/components/workbench-shell/dock-panel/xterm-terminal';
import { useComposerAttachmentInbox } from '@/renderer/state/composer';
import type { TerminalRendererAdapter } from '@/renderer/types/terminal';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

const { adapter, selection, toastError, toastSuccess } = vi.hoisted(() => ({
	adapter: {
		attach: vi.fn(),
		clear: vi.fn(),
		dispose: vi.fn(),
		fit: vi.fn(() => ({ cols: 80, rows: 24 })),
		focus: vi.fn(),
		getSelection: vi.fn(() => ''),
		onData: vi.fn(() => () => undefined),
		setFont: vi.fn(),
		setScrollback: vi.fn(),
		whenFontReady: vi.fn(() => Promise.resolve()),
		write: vi.fn(),
	} satisfies Record<keyof TerminalRendererAdapter, unknown>,
	selection: { text: '' },
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({
	toast: { error: toastError, success: toastSuccess },
}));

// xterm.js draws to a canvas against a live PTY, neither of which happy-dom
// has; the adapter boundary is exactly what the component talks to.
vi.mock('@/renderer/lib/terminal/xterm-adapter', () => ({
	createXtermAdapter: () => adapter,
	DEFAULT_FONT_FAMILY: 'monospace',
}));

const DOCUMENT_NAME = 'npm-run-dev-selection.txt';
const DOCUMENT_PATH = `.context/attachments/aa44bb/${DOCUMENT_NAME}`;

/** Filenames the workspace store was asked to file a selection under. */
const storedNames: string[] = [];

/** Reports what the composer inbox holds, so a test can assert what was queued. */
function AttachmentProbe({ workspaceCwd }: { workspaceCwd: string }) {
	const { pending } = useComposerAttachmentInbox('chat-1', workspaceCwd);
	return (
		<ul data-testid='queued'>
			{pending.map((attachment) => (
				<li key={attachment.id}>
					{`${attachment.kind}|${attachment.label}|${'source' in attachment ? (attachment.source?.label ?? '') : ''}`}
				</li>
			))}
		</ul>
	);
}

/** The attachment entries the probe is currently reporting. */
function queuedEntries(): string[] {
	return Array.from(
		screen.getByTestId('queued').querySelectorAll('li'),
		(item) => item.textContent ?? '',
	);
}

/**
 * Renders one terminal surface plus the probe watching its workspace root. The
 * attachment channel is a module-level atom, so each test gets its own store or
 * a queued chip outlives the test that queued it.
 */
function renderTerminal(options: { readOnly?: boolean } = {}) {
	renderWithProviders(
		<Provider store={createStore()}>
			<button data-testid='composer' type='button'>
				composer
			</button>
			<XtermTerminal
				readOnly={options.readOnly}
				sessionStatus={null}
				terminalId='t1'
				terminalLabel='npm run dev'
				workspaceCwd='/ws/repo'
			/>
			<AttachmentProbe workspaceCwd='/ws/repo' />
		</Provider>,
	);
}

/** Right-clicks the terminal surface, opening its shared context menu. */
function openTerminalMenu() {
	const surface = adapter.attach.mock.calls.at(-1)?.[0] as HTMLElement;
	fireEvent.contextMenu(surface);
}

beforeEach(() => {
	selection.text = '';
	for (const spy of Object.values(adapter)) {
		spy.mockClear();
	}
	adapter.fit.mockReturnValue({ cols: 80, rows: 24 });
	adapter.getSelection.mockImplementation(() => selection.text);
	adapter.onData.mockImplementation(() => () => undefined);
	toastError.mockClear();
	toastSuccess.mockClear();
	storedNames.length = 0;
	installLocalStorage();
	installEnsemblrApi({
		onTerminalOutput: () => () => undefined,
		resizeTerminalSession: async () => undefined,
		terminalSnapshot: async () => ({ lastSeq: 0, scrollback: '' }),
		writeTerminalSession: async () => undefined,
		writeWorkspaceFileAttachment: async (request: { name?: string }) => {
			storedNames.push(request.name ?? '');
			return {
				file: { kind: 'file', name: DOCUMENT_NAME, path: DOCUMENT_PATH },
			};
		},
	});
	return () => clearEnsemblrApi();
});

// The pane's name has to survive the whole path: the store files the selection
// under it, and the chip reads it — otherwise output from four open terminals
// arrives as four identical anonymous chips.
test('attaches the selection to the chat as a chip naming its terminal', async () => {
	selection.text = 'error: boom\n  at main\n';
	renderTerminal();

	openTerminalMenu();
	fireEvent.click(
		await screen.findByRole('menuitem', { name: 'Attach selection to chat' }),
	);

	await waitFor(() => {
		expect(queuedEntries()).toEqual([
			'pasted-text|npm-run-dev-selection.txt|npm run dev',
		]);
	});
	expect(storedNames).toEqual(['npm-run-dev-selection.txt']);
	expect(toastSuccess).toHaveBeenCalledTimes(1);
});

// The failure this prevents: reading the selection when the surface mounts, or
// in the capture phase, both of which predate xterm's own contextmenu handler.
test('reads the selection when the menu is opened, not before', async () => {
	renderTerminal();

	expect(adapter.getSelection).not.toHaveBeenCalled();

	selection.text = 'first';
	openTerminalMenu();
	await screen.findByRole('menuitem', { name: 'Attach selection to chat' });

	expect(adapter.getSelection).toHaveBeenCalledTimes(1);
});

test('offers nothing to attach when the terminal has no selection', async () => {
	renderTerminal();

	openTerminalMenu();
	const item = await screen.findByRole('menuitem', {
		name: 'Attach selection to chat',
	});

	expect(item).toHaveAttribute('aria-disabled', 'true');
	fireEvent.click(item);

	expect(queuedEntries()).toEqual([]);
	expect(toastSuccess).not.toHaveBeenCalled();
});

// Radix restores focus to the trigger element on close, which is the wrapper
// around the terminal rather than the terminal itself — leaving an interactive
// pane that swallows every keystroke until the user clicks it.
test('hands keyboard focus back to an interactive terminal when the menu closes', async () => {
	selection.text = 'boom';
	renderTerminal();

	openTerminalMenu();
	await screen.findByRole('menuitem', { name: 'Attach selection to chat' });
	adapter.focus.mockClear();
	fireEvent.keyDown(document.activeElement ?? document.body, {
		key: 'Escape',
	});

	await waitFor(() => {
		expect(adapter.focus).toHaveBeenCalledTimes(1);
	});
});

// A read-only pane must not pull focus off the composer, but Radix's own
// restore targets the trigger — a wrapper with no `tabIndex`, so `focus()` is a
// no-op and the caret lands on `<body>`, restarting Tab from the top of the
// document. It goes back where it was instead.
test('returns focus where it was when the surface is a read-only script pane', async () => {
	selection.text = 'boom';
	renderTerminal({ readOnly: true });
	const composer = screen.getByTestId('composer');
	composer.focus();

	openTerminalMenu();
	await screen.findByRole('menuitem', { name: 'Attach selection to chat' });
	adapter.focus.mockClear();
	fireEvent.keyDown(document.activeElement ?? document.body, {
		key: 'Escape',
	});

	await waitFor(() => {
		expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
	});
	expect(adapter.focus).not.toHaveBeenCalled();
	expect(document.activeElement).toBe(composer);
});
