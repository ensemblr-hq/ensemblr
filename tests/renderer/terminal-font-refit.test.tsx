// @vitest-environment happy-dom

/**
 * How many columns and rows a pane holds is derived from the cell box, and the
 * cell box is measured from whichever font faces were rasterizable at the time.
 * A face that lands afterwards re-measures the surface, so a fit taken before
 * it landed leaves the PTY wrapping at the wrong width for the rest of the
 * session — which is what `whenFontReady` exists to prevent, on the mount path
 * and on the live Appearance-settings path alike.
 */

import { act } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { beforeEach, expect, test, vi } from 'vitest';

import { XtermTerminal } from '@/renderer/components/workbench-shell/dock-panel/xterm-terminal';
import { appSettingsAtom } from '@/renderer/state/preferences';
import type { TerminalRendererAdapter } from '@/renderer/types/terminal';
import { type AppSettings, DEFAULT_APP_SETTINGS } from '@/shared/config';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

const { adapter, pendingFontLoads } = vi.hoisted(() => ({
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
	pendingFontLoads: [] as Array<() => void>,
}));

// xterm.js draws to a canvas against a live PTY, neither of which happy-dom
// has; the adapter boundary is exactly what the component talks to.
vi.mock('@/renderer/lib/terminal/xterm-adapter', () => ({
	createXtermAdapter: () => adapter,
	DEFAULT_FONT_FAMILY: 'monospace',
}));

/** Geometry the PTY was asked to take, in the order the component asked. */
const resizes: Array<{ cols: number; rows: number }> = [];

/**
 * Gives every element a non-zero box. The component refuses to fit a zero-size
 * container — a force-mounted hidden tab — and happy-dom lays nothing out, so
 * without this every fit in this file is skipped for the wrong reason.
 */
function stubElementBox(): void {
	for (const property of ['clientHeight', 'clientWidth']) {
		Object.defineProperty(HTMLElement.prototype, property, {
			configurable: true,
			get: () => 400,
		});
	}
}

/** Settles every outstanding `whenFontReady()` promise and flushes React. */
async function landFontFaces(): Promise<void> {
	const settling = pendingFontLoads.splice(0);
	await act(async () => {
		for (const resolve of settling) {
			resolve();
		}
	});
}

/** Renders one terminal surface against a store the test can write settings to. */
function renderTerminal(store: ReturnType<typeof createStore>) {
	return renderWithProviders(
		<Provider store={store}>
			<XtermTerminal
				sessionStatus={null}
				terminalId='t1'
				terminalLabel='npm run dev'
				workspaceCwd='/ws/repo'
			/>
		</Provider>,
	);
}

/** Applies an appearance patch the way the Appearance settings panel would. */
function setAppearance(
	store: ReturnType<typeof createStore>,
	patch: Partial<AppSettings['appearance']>,
): void {
	const current = store.get(appSettingsAtom);
	act(() => {
		store.set(appSettingsAtom, {
			...current,
			appearance: { ...current.appearance, ...patch },
		});
	});
}

beforeEach(() => {
	for (const spy of Object.values(adapter)) {
		spy.mockClear();
	}
	adapter.fit.mockReturnValue({ cols: 80, rows: 24 });
	adapter.onData.mockImplementation(() => () => undefined);
	adapter.whenFontReady.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				pendingFontLoads.push(resolve);
			}),
	);
	pendingFontLoads.length = 0;
	resizes.length = 0;
	stubElementBox();
	installLocalStorage();
	installEnsemblrApi({
		onTerminalOutput: () => () => undefined,
		resizeTerminalSession: async (geometry: { cols: number; rows: number }) => {
			resizes.push({ cols: geometry.cols, rows: geometry.rows });
		},
		terminalSnapshot: async () => ({ lastSeq: 0, scrollback: '' }),
		writeTerminalSession: async () => undefined,
	});
	return () => clearEnsemblrApi();
});

test('re-fits the surface once the mount-time font faces land', async () => {
	renderTerminal(createStore());

	expect(adapter.fit).toHaveBeenCalledTimes(1);

	await landFontFaces();

	expect(adapter.fit).toHaveBeenCalledTimes(2);
	expect(resizes).toEqual([
		{ cols: 80, rows: 24 },
		{ cols: 80, rows: 24 },
	]);
});

// Without this the pane keeps the geometry it measured against the fallback
// font: the switch itself is applied, but the PTY is never told the width
// changed, so the shell wraps at the old column count until the next resize.
test('re-fits again once a live font change has loaded its faces', async () => {
	const store = createStore();
	renderTerminal(store);
	await landFontFaces();
	adapter.fit.mockClear();
	adapter.fit.mockReturnValue({ cols: 96, rows: 24 });
	resizes.length = 0;

	setAppearance(store, { terminalFont: 'Fira Code' });

	expect(adapter.setFont).toHaveBeenCalledWith({
		fontFamily: '"Fira Code", monospace',
		fontSize: DEFAULT_APP_SETTINGS.appearance.terminalFontSize,
	});
	expect(adapter.fit).toHaveBeenCalledTimes(1);

	await landFontFaces();

	expect(adapter.fit).toHaveBeenCalledTimes(2);
	expect(resizes).toEqual([
		{ cols: 96, rows: 24 },
		{ cols: 96, rows: 24 },
	]);
});

// A pane torn down between the font change and the face landing would otherwise
// fit a disposed surface and resize a session that no longer has one.
test('drops the pending re-fit when the surface is torn down first', async () => {
	const store = createStore();
	const { unmount } = renderTerminal(store);
	await landFontFaces();
	setAppearance(store, { terminalFont: 'Fira Code' });
	adapter.fit.mockClear();

	unmount();
	await landFontFaces();

	expect(adapter.fit).not.toHaveBeenCalled();
});
