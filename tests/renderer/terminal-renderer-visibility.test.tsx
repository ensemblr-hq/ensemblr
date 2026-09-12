// @vitest-environment happy-dom

/**
 * The dock force-mounts every tab so each terminal keeps its scrollback and its
 * PTY binding across a tab switch. That makes visibility something the surface
 * has to be told, because one WebGL context per mounted tab exhausts Chromium's
 * ~16-context page budget and silently evicts the surfaces the user can see.
 */

import { act } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { XtermTerminal } from '@/renderer/components/workbench-shell/dock-panel/xterm-terminal';
import type { TerminalRendererAdapter } from '@/renderer/types/terminal';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

const { adapter } = vi.hoisted(() => ({
	adapter: {
		attach: vi.fn(),
		clear: vi.fn(),
		dispose: vi.fn(),
		fit: vi.fn(() => ({ cols: 80, rows: 24 })),
		focus: vi.fn(),
		getSelection: vi.fn(() => ''),
		onData: vi.fn(() => () => undefined),
		setFont: vi.fn(),
		setRendererVisible: vi.fn(),
		setScrollback: vi.fn(),
		whenFontReady: vi.fn(() => Promise.resolve()),
		write: vi.fn(),
	} satisfies Record<keyof TerminalRendererAdapter, unknown>,
}));

vi.mock('@/renderer/lib/terminal/xterm-adapter', () => ({
	createXtermAdapter: () => adapter,
	DEFAULT_FONT_FAMILY: 'monospace',
}));

/** Renders one terminal surface at a declared visibility. */
function renderTerminal(isVisible: boolean) {
	return renderWithProviders(
		<XtermTerminal
			isVisible={isVisible}
			sessionStatus={null}
			terminalId='t1'
			terminalLabel='npm run dev'
			workspaceCwd='/ws/repo'
		/>,
	);
}

beforeEach(() => {
	vi.useFakeTimers();
	for (const spy of Object.values(adapter)) {
		spy.mockClear();
	}
	adapter.fit.mockReturnValue({ cols: 80, rows: 24 });
	adapter.onData.mockImplementation(() => () => undefined);
	adapter.whenFontReady.mockImplementation(() => Promise.resolve());
	installLocalStorage();
	installEnsemblrApi({
		onTerminalOutput: () => () => undefined,
		resizeTerminalSession: async () => undefined,
		terminalSnapshot: async () => ({ lastSeq: 0, scrollback: '' }),
		writeTerminalSession: async () => undefined,
	});
});

afterEach(() => {
	vi.useRealTimers();
	clearEnsemblrApi();
});

test('takes a GPU context as soon as the surface is on screen', () => {
	renderTerminal(true);

	expect(adapter.setRendererVisible).toHaveBeenCalledWith(true);
});

test('holds the context through a brief hide, then gives it back', () => {
	const { rerender } = renderTerminal(true);
	adapter.setRendererVisible.mockClear();

	rerender(
		<XtermTerminal
			isVisible={false}
			sessionStatus={null}
			terminalId='t1'
			terminalLabel='npm run dev'
			workspaceCwd='/ws/repo'
		/>,
	);

	act(() => {
		vi.advanceTimersByTime(1_000);
	});
	expect(adapter.setRendererVisible).not.toHaveBeenCalled();

	act(() => {
		vi.advanceTimersByTime(5_000);
	});
	expect(adapter.setRendererVisible).toHaveBeenCalledWith(false);
});

// Cycling tabs would otherwise tear a context down and build it back up per
// keystroke of the tab shortcut.
test('keeps the context when the tab comes back inside the grace period', () => {
	const { rerender } = renderTerminal(true);
	adapter.setRendererVisible.mockClear();

	const at = (isVisible: boolean) => (
		<XtermTerminal
			isVisible={isVisible}
			sessionStatus={null}
			terminalId='t1'
			terminalLabel='npm run dev'
			workspaceCwd='/ws/repo'
		/>
	);

	rerender(at(false));
	act(() => {
		vi.advanceTimersByTime(1_000);
	});
	rerender(at(true));
	act(() => {
		vi.advanceTimersByTime(30_000);
	});

	expect(adapter.setRendererVisible).not.toHaveBeenCalledWith(false);
	expect(adapter.setRendererVisible).toHaveBeenCalledWith(true);
});

test('never takes a context for a surface that mounts hidden', () => {
	renderTerminal(false);

	act(() => {
		vi.advanceTimersByTime(30_000);
	});

	expect(adapter.setRendererVisible).not.toHaveBeenCalledWith(true);
});
