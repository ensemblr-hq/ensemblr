// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startLocalStorageMirror } from '../../src/renderer/lib/storage-mirror.ts';
import type { RendererStorageSnapshot } from '../../src/shared/ipc/contracts/renderer-storage.ts';
import { clearEnsemblrApi, installEnsemblrApi } from './support/dom';

const FLUSH_DELAY_MS = 1_000;

type MirrorSpy = ReturnType<typeof installMirrorApi>;

function installMirrorApi() {
	const mirrorRendererStorage = vi.fn(
		async (_request: RendererStorageSnapshot) => ({ status: 'stored' }),
	);
	installEnsemblrApi({ mirrorRendererStorage });
	return mirrorRendererStorage;
}

function lastSnapshot(mirror: MirrorSpy): Record<string, string> | undefined {
	return mirror.mock.calls.at(-1)?.[0].entries;
}

describe('startLocalStorageMirror', () => {
	let stop: () => void = () => {};

	beforeEach(() => {
		vi.useFakeTimers();
		window.localStorage.clear();
	});

	afterEach(() => {
		stop();
		stop = () => {};
		vi.useRealTimers();
		window.localStorage.clear();
		clearEnsemblrApi();
	});

	test('mirrors what storage already holds as soon as it starts', async () => {
		window.localStorage.setItem('ensemblr_pref_send_shortcut', '"enter"');
		const mirror = installMirrorApi();

		stop = startLocalStorageMirror();
		await vi.advanceTimersByTimeAsync(0);

		expect(mirror).toHaveBeenCalledTimes(1);
		expect(lastSnapshot(mirror)).toEqual({
			ensemblr_pref_send_shortcut: '"enter"',
		});
	});

	test('mirrors a later write once the burst has settled', async () => {
		const mirror = installMirrorApi();
		stop = startLocalStorageMirror();
		await vi.advanceTimersByTimeAsync(0);

		window.localStorage.setItem('ensemblr_pref_theme', '"dark"');
		window.localStorage.setItem('ensemblr_pref_zoom', '1');

		expect(mirror).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

		expect(mirror).toHaveBeenCalledTimes(2);
		expect(lastSnapshot(mirror)).toEqual({
			ensemblr_pref_theme: '"dark"',
			ensemblr_pref_zoom: '1',
		});
	});

	test('mirrors a removal, so a deleted preference does not come back', async () => {
		window.localStorage.setItem('ensemblr_pref_theme', '"dark"');
		const mirror = installMirrorApi();
		stop = startLocalStorageMirror();
		await vi.advanceTimersByTimeAsync(0);

		window.localStorage.removeItem('ensemblr_pref_theme');
		await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

		expect(lastSnapshot(mirror)).toEqual({});
	});

	test('does not push a snapshot that has not changed', async () => {
		window.localStorage.setItem('ensemblr_pref_theme', '"dark"');
		const mirror = installMirrorApi();
		stop = startLocalStorageMirror();
		await vi.advanceTimersByTimeAsync(0);

		window.localStorage.setItem('ensemblr_pref_theme', '"dark"');
		await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

		expect(mirror).toHaveBeenCalledTimes(1);
	});

	test('ignores writes to sessionStorage, which shares the prototype', async () => {
		const mirror = installMirrorApi();
		stop = startLocalStorageMirror();
		await vi.advanceTimersByTimeAsync(0);

		window.sessionStorage.setItem('scratch', 'value');
		await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

		expect(mirror).toHaveBeenCalledTimes(1);
	});

	test('flushes when the document goes away', async () => {
		const mirror = installMirrorApi();
		stop = startLocalStorageMirror();
		await vi.advanceTimersByTimeAsync(0);

		window.localStorage.setItem('ensemblr_pref_theme', '"dark"');
		window.dispatchEvent(new Event('pagehide'));
		await vi.advanceTimersByTimeAsync(0);

		expect(mirror).toHaveBeenCalledTimes(2);
		expect(lastSnapshot(mirror)).toEqual({ ensemblr_pref_theme: '"dark"' });
	});

	test('restores the storage methods when it stops', async () => {
		const mirror = installMirrorApi();
		const originalSetItem = window.localStorage.setItem;

		const stopMirror = startLocalStorageMirror();
		await vi.advanceTimersByTimeAsync(0);
		stopMirror();

		expect(window.localStorage.setItem).toBe(originalSetItem);

		window.localStorage.setItem('ensemblr_pref_theme', '"dark"');
		await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

		expect(mirror).toHaveBeenCalledTimes(1);
	});

	// The renderer suite installs a plain-object storage, so every test above
	// patches the instance. A real browser puts the methods on the prototype and
	// turns an instance assignment into a stored key — the other branch of
	// `writeMethodOwner`, and the only one production ever takes.
	test('hooks a storage whose methods live on its prototype', async () => {
		const items = new Map<string, string>();
		const prototype = {
			clear: () => items.clear(),
			getItem: (key: string) => items.get(key) ?? null,
			key: (index: number) => Array.from(items.keys())[index] ?? null,
			removeItem: (key: string) => {
				items.delete(key);
			},
			setItem: (key: string, value: string) => {
				items.set(key, value);
			},
		};
		const storage = Object.create(prototype) as Storage;
		Object.defineProperty(storage, 'length', { get: () => items.size });
		const realLocalStorage = Object.getOwnPropertyDescriptor(
			globalThis,
			'localStorage',
		);
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			value: storage,
		});
		const originalSetItem = prototype.setItem;
		const mirror = installMirrorApi();

		try {
			const stopMirror = startLocalStorageMirror();
			await vi.advanceTimersByTimeAsync(0);

			storage.setItem('ensemblr_pref_theme', '"dark"');
			await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

			expect(lastSnapshot(mirror)).toEqual({ ensemblr_pref_theme: '"dark"' });
			expect(Object.hasOwn(storage, 'setItem')).toBe(false);

			stopMirror();

			expect(prototype.setItem).toBe(originalSetItem);
		} finally {
			if (realLocalStorage) {
				Object.defineProperty(globalThis, 'localStorage', realLocalStorage);
			}
		}
	});

	test('keeps retrying after main declines a snapshot', async () => {
		const mirrorRendererStorage = vi
			.fn()
			.mockResolvedValueOnce({
				reason: 'database-unavailable',
				status: 'skipped',
			})
			.mockResolvedValue({ status: 'stored' });
		installEnsemblrApi({ mirrorRendererStorage });

		stop = startLocalStorageMirror();
		await vi.advanceTimersByTimeAsync(0);

		window.localStorage.setItem('ensemblr_pref_theme', '"dark"');
		await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);

		expect(mirrorRendererStorage).toHaveBeenCalledTimes(2);
	});

	test('does nothing when the app bridge is absent', () => {
		clearEnsemblrApi();

		expect(() => {
			startLocalStorageMirror()();
		}).not.toThrow();
	});
});
