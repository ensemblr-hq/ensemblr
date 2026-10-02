// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createXtermAdapter,
	DEFAULT_FONT_FAMILY,
} from '@/renderer/lib/terminal/xterm-adapter';

const { calls, fontState, terminalState } = vi.hoisted(() => ({
	calls: [] as string[],
	fontState: {
		available: false,
		failing: [] as string[],
		loaded: [] as string[],
		resolveLoad: [] as Array<() => void>,
	},
	terminalState: { familyWrites: [] as string[] },
}));

vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		fit() {}
	},
}));

vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));

vi.mock('@xterm/addon-webgl', () => ({
	WebglAddon: class {
		dispose() {}
		onContextLoss() {}
	},
}));

vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		cols = 80;
		rows = 24;
		options = new Proxy({} as Record<string, unknown>, {
			set(target, key, value) {
				if (key === 'fontFamily') {
					terminalState.familyWrites.push(value as string);
				}
				target[key as string] = value;
				return true;
			},
		});
		clear() {}
		clearTextureAtlas() {
			calls.push('clearTextureAtlas');
		}
		dispose() {}
		focus() {}
		getSelection() {
			return '';
		}
		loadAddon() {}
		onData() {
			return { dispose() {} };
		}
		open() {}
		write() {}
	},
}));

/**
 * Installs a `document.fonts` stub whose loads settle only when released. A
 * face named in `fontState.failing` rejects the way the real API does when a
 * font file cannot be fetched or decoded.
 */
function installFontSet(): void {
	Object.defineProperty(document, 'fonts', {
		configurable: true,
		value: {
			check: () => fontState.available,
			load: (face: string) => {
				fontState.loaded.push(face);
				return new Promise<unknown[]>((resolve, reject) => {
					fontState.resolveLoad.push(() =>
						fontState.failing.includes(face)
							? reject(new Error(`failed to load ${face}`))
							: resolve([]),
					);
				});
			},
		},
	});
}

/** Settles every pending face load and drains the resulting microtasks. */
async function completeFontLoads(): Promise<void> {
	fontState.available = true;
	for (const resolve of fontState.resolveLoad) {
		resolve();
	}
	fontState.resolveLoad.length = 0;
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe('terminal font faces', () => {
	beforeEach(() => {
		calls.length = 0;
		fontState.available = false;
		fontState.failing.length = 0;
		fontState.loaded.length = 0;
		fontState.resolveLoad.length = 0;
		terminalState.familyWrites.length = 0;
		installFontSet();
	});

	afterEach(() => {
		Reflect.deleteProperty(document, 'fonts');
	});

	// Canvas text never starts a webfont fetch of its own, so the bundled face
	// would stay unloaded on a screen where the terminal is its only consumer.
	it('requests every style and weight the terminal draws with', () => {
		createXtermAdapter({ fontSize: 13 }).attach(document.createElement('div'));

		expect(fontState.loaded).toEqual([
			`13px ${DEFAULT_FONT_FAMILY}`,
			`bold 13px ${DEFAULT_FONT_FAMILY}`,
			`italic 13px ${DEFAULT_FONT_FAMILY}`,
			`italic bold 13px ${DEFAULT_FONT_FAMILY}`,
		]);
	});

	it('re-measures and drops stale glyphs once the faces land', async () => {
		const adapter = createXtermAdapter();
		adapter.attach(document.createElement('div'));

		expect(calls).not.toContain('clearTextureAtlas');

		await completeFontLoads();

		expect(terminalState.familyWrites).toEqual([
			'monospace',
			DEFAULT_FONT_FAMILY,
		]);
		expect(calls).toEqual(['clearTextureAtlas']);
	});

	it('skips the redraw when the faces are already rasterizable', async () => {
		fontState.available = true;
		const adapter = createXtermAdapter();

		adapter.attach(document.createElement('div'));
		await adapter.whenFontReady();

		expect(fontState.loaded).toEqual([]);
		expect(calls).toEqual([]);
	});

	it('leaves a surface disposed before the faces land untouched', async () => {
		const adapter = createXtermAdapter();
		adapter.attach(document.createElement('div'));

		adapter.dispose();
		await completeFontLoads();

		expect(calls).toEqual([]);
	});

	it('reloads the faces when the user picks another font', async () => {
		const adapter = createXtermAdapter();
		adapter.attach(document.createElement('div'));
		await completeFontLoads();
		fontState.available = false;
		fontState.loaded.length = 0;

		adapter.setFont({ fontFamily: '"Fira Code", monospace', fontSize: 16 });

		expect(fontState.loaded).toEqual([
			'16px "Fira Code", monospace',
			'bold 16px "Fira Code", monospace',
			'italic 16px "Fira Code", monospace',
			'italic bold 16px "Fira Code", monospace',
		]);
	});

	// A load started for the old stack must not settle on top of the new one.
	it('drops a redraw for a font the user has already moved off', async () => {
		const adapter = createXtermAdapter();
		adapter.attach(document.createElement('div'));

		adapter.setFont({ fontFamily: '"Fira Code", monospace' });
		await completeFontLoads();

		expect(terminalState.familyWrites).toEqual([
			'"Fira Code", monospace',
			'monospace',
			'"Fira Code", monospace',
		]);
	});

	// `fonts.load` rejects on a face that cannot be fetched or decoded. Failing
	// the whole batch would drop the redraw for the faces that did land, and the
	// rejection would surface unhandled in the caller's re-fit chain.
	it('still redraws, and never rejects, when one face fails to load', async () => {
		const adapter = createXtermAdapter({ fontSize: 13 });
		fontState.failing.push(`italic bold 13px ${DEFAULT_FONT_FAMILY}`);
		adapter.attach(document.createElement('div'));

		await completeFontLoads();
		await expect(adapter.whenFontReady()).resolves.toBeUndefined();

		expect(calls).toEqual(['clearTextureAtlas']);
	});

	it('resolves without redrawing when the document exposes no font set', async () => {
		Object.defineProperty(document, 'fonts', {
			configurable: true,
			value: undefined,
		});
		const adapter = createXtermAdapter();

		adapter.attach(document.createElement('div'));
		await adapter.whenFontReady();

		expect(calls).toEqual([]);
	});
});
