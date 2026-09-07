// Hermetic Web Storage for renderer tests.
//
// happy-dom ships both storages on its window, but Vitest's happy-dom
// environment only copies a window property onto the process global when the
// global has none: `getWindowKeys` drops any key already `in global` unless it
// is on Vitest's own allowlist, and neither storage key is on it. So what a test
// sees is decided by the host Node rather than by happy-dom. Node 24 defines
// neither key, and both happy-dom stores are published. Node 26 defines both —
// `localStorage` as an accessor yielding `undefined` without
// `--localstorage-file`, `sessionStorage` as a real store — so happy-dom's are
// dropped and the suite gets no `localStorage` at all plus a `sessionStorage`
// belonging to the process.
//
// Anything built on `atomWithStorage` then behaves differently per host: its
// `onMount` re-reads the key, so with no storage it resets a value the test
// seeded before render, and with a borrowed one it reads back an earlier write —
// from the previous test in the file for a happy-dom store, which `isolate: true`
// replaces per file, and from the previous file for the process-global one,
// which it does not.
//
// Tests therefore own their storage rather than borrowing the host's, in the
// renderer suite's `node`-environment files as much as its happy-dom ones. The
// install is deliberately unconditional: production always has both storages, so
// a guard on `typeof globalThis.localStorage` reads the branch the app really
// takes, and skipping the `node` files would leave Node 26's process-global
// `sessionStorage` leaking across them.

/**
 * Builds a Map-backed `Storage` that keeps a test's reads and writes in memory.
 * @returns A storage object with no backing beyond the returned instance
 */
function createMemoryStorage(): Storage {
	const items = new Map<string, string>();
	return {
		clear: () => items.clear(),
		getItem: (key) => items.get(key) ?? null,
		key: (index) => Array.from(items.keys())[index] ?? null,
		get length() {
			return items.size;
		},
		removeItem: (key) => {
			items.delete(key);
		},
		setItem: (key, value) => {
			items.set(key, value);
		},
	};
}

/**
 * Installs one empty store on the global object under `name`, replacing
 * whatever the host Node, happy-dom, or an earlier test left there. The
 * happy-dom environment makes `window` the global object, so this is what
 * renderer code reading `window.localStorage` sees.
 * @param name - Which Web Storage global to replace
 */
function installStorage(name: 'localStorage' | 'sessionStorage'): void {
	Object.defineProperty(globalThis, name, {
		configurable: true,
		value: createMemoryStorage(),
		writable: true,
	});
}

/** Installs empty `localStorage` and `sessionStorage`, as the shared setup does before every test. */
export function installWebStorage(): void {
	installStorage('localStorage');
	installStorage('sessionStorage');
}

/**
 * Resets `localStorage` alone to a fresh empty store, leaving `sessionStorage`
 * as it is. The shared setup already installs a fresh pair before every test, so
 * this is for a test that wants a clean store part-way through one — between two
 * renders in the same test, say.
 */
export function installLocalStorage(): void {
	installStorage('localStorage');
}
