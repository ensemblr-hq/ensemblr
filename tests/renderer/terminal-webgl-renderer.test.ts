// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createXtermAdapter } from '@/renderer/lib/terminal/xterm-adapter';

const { calls, webglState } = vi.hoisted(() => ({
	calls: [] as string[],
	webglState: {
		contextLossHandlers: [] as Array<() => void>,
		disposeCount: 0,
		throwOnConstruct: false,
		throwOnLoad: false,
	},
}));

vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		fit() {}
	},
}));

vi.mock('@xterm/addon-web-links', () => ({
	WebLinksAddon: class {},
}));

vi.mock('@xterm/addon-webgl', () => ({
	WebglAddon: class {
		constructor() {
			if (webglState.throwOnConstruct) {
				throw new Error('WebGL unavailable');
			}
			calls.push('webgl:construct');
		}
		dispose() {
			webglState.disposeCount += 1;
			calls.push('webgl:dispose');
		}
		onContextLoss(handler: () => void) {
			webglState.contextLossHandlers.push(handler);
		}
	},
}));

vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		cols = 80;
		rows = 24;
		options: Record<string, unknown> = {};
		clear() {}
		dispose() {
			calls.push('terminal:dispose');
		}
		focus() {}
		getSelection() {
			return '';
		}
		loadAddon(addon: unknown) {
			if (webglState.throwOnLoad && addon?.constructor?.name === 'WebglAddon') {
				throw new Error('failed to create WebGL context');
			}
		}
		onData() {
			return { dispose() {} };
		}
		open() {
			calls.push('terminal:open');
		}
		write() {}
	},
}));

describe('terminal WebGL renderer', () => {
	beforeEach(() => {
		calls.length = 0;
		webglState.contextLossHandlers.length = 0;
		webglState.disposeCount = 0;
		webglState.throwOnConstruct = false;
		webglState.throwOnLoad = false;
	});

	// The addon takes over a canvas the terminal only creates once it has a
	// container, so loading it before open() leaves the DOM renderer in place.
	it('loads the WebGL renderer only after the terminal is opened', () => {
		const adapter = createXtermAdapter();

		adapter.attach(document.createElement('div'));

		expect(calls).toEqual(['terminal:open', 'webgl:construct']);
	});

	it('keeps the DOM renderer when the GPU cannot serve a context', () => {
		webglState.throwOnLoad = true;
		const adapter = createXtermAdapter();

		expect(() => adapter.attach(document.createElement('div'))).not.toThrow();

		adapter.dispose();
		expect(calls).toContain('terminal:dispose');
		expect(webglState.disposeCount).toBe(0);
	});

	it('keeps the DOM renderer when the addon cannot be constructed', () => {
		webglState.throwOnConstruct = true;
		const adapter = createXtermAdapter();

		expect(() => adapter.attach(document.createElement('div'))).not.toThrow();
	});

	it('disposes the addon on context loss and does not dispose it twice', () => {
		const adapter = createXtermAdapter();
		adapter.attach(document.createElement('div'));

		for (const handler of webglState.contextLossHandlers) {
			handler();
		}
		adapter.dispose();

		expect(webglState.disposeCount).toBe(1);
	});

	// The addon restores a freshly built DOM renderer unless the terminal's core
	// is already disposed, so disposing it ahead of the terminal would build one
	// only to tear it down again. `terminal.dispose` disposes its own addons.
	it('leaves addon disposal to the terminal', () => {
		const adapter = createXtermAdapter();
		adapter.attach(document.createElement('div'));

		adapter.dispose();

		expect(calls).toEqual([
			'terminal:open',
			'webgl:construct',
			'terminal:dispose',
		]);
	});
});
