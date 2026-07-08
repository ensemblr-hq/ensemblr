import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';

import {
	deleteLastUsedOpenTarget,
	readLastUsedOpenTarget,
	writeLastUsedOpenTarget,
} from '../../src/renderer/state/workspace/open-target-history';

const STORAGE_KEY = 'ensemble_workspace_open_target_last_used_v1';

const globalScope = globalThis as unknown as {
	localStorage?: Storage;
	window?: Window;
};
const originalWindow = globalScope.window;
const originalLocalStorage = globalScope.localStorage;

function installLocalStorageStub(): void {
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
	};
	const stubWindow = { localStorage } as unknown as Window;
	globalScope.window = stubWindow;
	globalScope.localStorage = localStorage as unknown as Storage;
}

function restoreGlobals(): void {
	if (originalWindow) {
		globalScope.window = originalWindow;
	} else {
		delete globalScope.window;
	}
	if (originalLocalStorage) {
		globalScope.localStorage = originalLocalStorage;
	} else {
		delete globalScope.localStorage;
	}
}

beforeEach(() => {
	installLocalStorageStub();
});
afterEach(() => {
	restoreGlobals();
});
afterAll(() => {
	restoreGlobals();
});

test('returns null when no entry exists for the workspace', () => {
	expect(readLastUsedOpenTarget('ws-1')).toBeNull();
});

test('round-trips a written entry', () => {
	writeLastUsedOpenTarget('ws-1', 'vscode');
	expect(readLastUsedOpenTarget('ws-1')).toBe('vscode');
});

test('isolates entries by workspace id', () => {
	writeLastUsedOpenTarget('ws-1', 'vscode');
	writeLastUsedOpenTarget('ws-2', 'zed');
	expect(readLastUsedOpenTarget('ws-1')).toBe('vscode');
	expect(readLastUsedOpenTarget('ws-2')).toBe('zed');
});

test('subsequent writes for the same workspace overwrite the entry', () => {
	writeLastUsedOpenTarget('ws-1', 'vscode');
	writeLastUsedOpenTarget('ws-1', 'zed');
	expect(readLastUsedOpenTarget('ws-1')).toBe('zed');
});

test('returns null when the stored payload is not valid JSON', () => {
	globalThis.window.localStorage.setItem(STORAGE_KEY, '{not json');
	expect(readLastUsedOpenTarget('ws-1')).toBeNull();
});

test('returns null when the stored payload is not a string map', () => {
	globalThis.window.localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify({ 'ws-1': { not: 'a string' } }),
	);
	expect(readLastUsedOpenTarget('ws-1')).toBeNull();
});

test('deleteLastUsedOpenTarget evicts the entry without touching siblings', () => {
	writeLastUsedOpenTarget('ws-1', 'vscode');
	writeLastUsedOpenTarget('ws-2', 'zed');

	deleteLastUsedOpenTarget('ws-1');

	expect(readLastUsedOpenTarget('ws-1')).toBeNull();
	expect(readLastUsedOpenTarget('ws-2')).toBe('zed');
});

test('deleteLastUsedOpenTarget is a no-op when no entry exists', () => {
	writeLastUsedOpenTarget('ws-2', 'zed');
	const snapshotBefore = globalThis.window.localStorage.getItem(STORAGE_KEY);

	deleteLastUsedOpenTarget('ws-1');

	expect(globalThis.window.localStorage.getItem(STORAGE_KEY)).toBe(
		snapshotBefore,
	);
});
