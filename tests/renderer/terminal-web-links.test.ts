// @vitest-environment happy-dom

import type { IBufferRange, ITerminalOptions } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createXtermAdapter } from '@/renderer/lib/terminal/xterm-adapter';
import { clearEnsemblrApi, installEnsemblrApi } from './support/dom';

const { terminalOptions, webLinksHandlers } = vi.hoisted(() => ({
	terminalOptions: [] as ITerminalOptions[],
	webLinksHandlers: [] as Array<
		((event: MouseEvent, uri: string) => void) | undefined
	>,
}));

vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		fit() {}
	},
}));

vi.mock('@xterm/addon-web-links', () => ({
	WebLinksAddon: class {
		constructor(handler?: (event: MouseEvent, uri: string) => void) {
			webLinksHandlers.push(handler);
		}
	},
}));

vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		cols = 80;
		rows = 24;
		options: Record<string, unknown>;
		constructor(options: Record<string, unknown>) {
			this.options = options;
			terminalOptions.push(options as ITerminalOptions);
		}
		clear() {}
		dispose() {}
		focus() {}
		loadAddon() {}
		onData() {
			return { dispose() {} };
		}
		open() {}
		write() {}
	},
}));

const CLICK_RANGE: IBufferRange = {
	end: { x: 20, y: 1 },
	start: { x: 1, y: 1 },
};

describe('terminal web links', () => {
	let consoleError: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		terminalOptions.length = 0;
		webLinksHandlers.length = 0;
		clearEnsemblrApi();
		consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('hands clicked links to the main process instead of xterm window.open', () => {
		const openExternal = vi.fn(() => Promise.resolve());
		installEnsemblrApi({ openExternal });
		createXtermAdapter();

		const handler = webLinksHandlers.at(0);
		expect(handler).toBeTypeOf('function');

		handler?.(new MouseEvent('click'), 'http://localhost:3000');

		expect(openExternal).toHaveBeenCalledWith('http://localhost:3000');
	});

	it('hands clicked OSC 8 hyperlinks to the main process as well', () => {
		const openExternal = vi.fn(() => Promise.resolve());
		installEnsemblrApi({ openExternal });
		createXtermAdapter();

		const activate = terminalOptions.at(0)?.linkHandler?.activate;
		expect(activate).toBeTypeOf('function');

		activate?.(new MouseEvent('click'), 'https://ensemblr.dev', CLICK_RANGE);

		expect(openExternal).toHaveBeenCalledWith('https://ensemblr.dev');
	});

	it('leaves OSC 8 links on the default http-only protocol policy', () => {
		createXtermAdapter();

		expect(terminalOptions.at(0)?.linkHandler?.allowNonHttpProtocols).not.toBe(
			true,
		);
	});

	it('ignores link clicks when the bridge is unavailable', () => {
		createXtermAdapter();
		const handler = webLinksHandlers.at(0);

		expect(() =>
			handler?.(new MouseEvent('click'), 'https://ensemblr.dev'),
		).not.toThrow();
		expect(consoleError).not.toHaveBeenCalled();
	});

	it('swallows a rejected openExternal so the click never surfaces an unhandled rejection', async () => {
		const openExternal = vi.fn(() => Promise.reject(new Error('denied')));
		installEnsemblrApi({ openExternal });
		createXtermAdapter();

		webLinksHandlers.at(0)?.(new MouseEvent('click'), 'https://ensemblr.dev');

		await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
	});
});
