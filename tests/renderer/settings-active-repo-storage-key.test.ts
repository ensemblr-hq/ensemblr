import { createStore } from 'jotai';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import {
	SETTINGS_ACTIVE_REPO_ID_STORAGE_KEY,
	settingsActiveRepoIdAtom,
} from '../../src/renderer/state/settings-ui';

const globalScope = globalThis as unknown as {
	localStorage?: Storage;
	window?: Window;
};
const originalWindow = globalScope.window;
const originalLocalStorage = globalScope.localStorage;

function installLocalStorageStub(): Storage {
	const store = new Map<string, string>();
	const localStorage = {
		clear: () => store.clear(),
		getItem: (key: string) => store.get(key) ?? null,
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		},
		removeItem: (key: string) => store.delete(key),
		setItem: (key: string, value: string) => store.set(key, value),
	} as unknown as Storage;

	globalScope.window = { localStorage } as unknown as Window;
	globalScope.localStorage = localStorage;

	return localStorage;
}

describe('settings active-repo storage key', () => {
	let storage: Storage;

	beforeEach(() => {
		storage = installLocalStorageStub();
	});

	afterAll(() => {
		globalScope.window = originalWindow;
		globalScope.localStorage = originalLocalStorage;
	});

	// The `/settings/repo` index route resolves this value from a `beforeLoad`
	// guard with no Jotai store, so it reads the raw key. Reading a key nothing
	// writes is silent: the redirect just falls through to user settings.
	test('the atom persists under the key the redirect guard reads', () => {
		const store = createStore();
		store.set(settingsActiveRepoIdAtom, 'repo-42');

		const raw = storage.getItem(SETTINGS_ACTIVE_REPO_ID_STORAGE_KEY);
		expect(raw).not.toBeNull();
		expect(JSON.parse(raw as string)).toBe('repo-42');
	});

	test('clearing the atom removes the value the guard would read', () => {
		const store = createStore();
		store.set(settingsActiveRepoIdAtom, 'repo-42');
		store.set(settingsActiveRepoIdAtom, null);

		const raw = storage.getItem(SETTINGS_ACTIVE_REPO_ID_STORAGE_KEY);
		expect(raw === null || JSON.parse(raw) === null).toBe(true);
	});
});
