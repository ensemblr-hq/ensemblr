/**
 * Keeps a copy of the renderer's `localStorage` in the main process.
 *
 * The renderer's preferences — viewed-changes marks, board order, pins, per-chat
 * model and Plan Mode overrides, PR drafts, recents — are keyed by the
 * document's *origin*. Moving the packaged renderer off `file:` onto an `app://`
 * scheme, which is what closing
 * `GrantFileProtocolExtraPrivileges` requires, gives it a new origin and an
 * empty storage area. Main is origin-blind, so the copy kept here is what
 * survives that move and seeds the new origin. See
 * `docs/adr/0071-mirror-renderer-local-storage-into-sqlite.md`.
 */

/** How long a burst of writes settles before the snapshot is pushed to main. */
const FLUSH_DELAY_MS = 1_000;

/**
 * Reads the whole of a storage area as a plain map.
 * @param storage - The storage area to read.
 * @returns Every key and value it currently holds.
 */
function readEntries(storage: Storage): Record<string, string> {
	const entries: Record<string, string> = {};
	for (let index = 0; index < storage.length; index += 1) {
		const key = storage.key(index);
		if (key === null) {
			continue;
		}
		const value = storage.getItem(key);
		if (value !== null) {
			entries[key] = value;
		}
	}
	return entries;
}

/**
 * Where a storage area's mutating methods actually live.
 *
 * A real `Storage` carries them on its prototype and treats *any* property
 * assigned to the instance as a stored key, so `storage.setItem = fn` would
 * write an entry called `setItem` and leave the method untouched. A stand-in
 * that owns its methods — the renderer suite installs one per test — has to be
 * patched in place instead.
 * @param storage - The storage area to patch.
 * @returns The object whose methods should be replaced.
 */
function writeMethodOwner(storage: Storage): Storage {
	return Object.hasOwn(storage, 'setItem')
		? storage
		: (Object.getPrototypeOf(storage) as Storage);
}

/**
 * Routes every write to `storage` through `onWrite`, by replacing its three
 * mutating methods.
 *
 * Replacing them is the only place all writers pass through: Jotai's
 * `atomWithStorage` reaches `localStorage` itself, and several modules call
 * `setItem`/`removeItem` directly, so there is no single wrapper to hook.
 * `sessionStorage` shares the `Storage` prototype, which is what the receiver
 * check excludes.
 * @param storage - The storage area whose writes should be reported.
 * @param onWrite - Called after each write lands.
 * @returns A function restoring the original methods.
 */
function reportStorageWrites(
	storage: Storage,
	onWrite: () => void,
): () => void {
	const owner = writeMethodOwner(storage);
	const original = {
		clear: owner.clear,
		removeItem: owner.removeItem,
		setItem: owner.setItem,
	};

	owner.setItem = function mirroredSetItem(
		this: Storage,
		key: string,
		value: string,
	): void {
		original.setItem.call(this, key, value);
		if (this === storage) {
			onWrite();
		}
	};

	owner.removeItem = function mirroredRemoveItem(
		this: Storage,
		key: string,
	): void {
		original.removeItem.call(this, key);
		if (this === storage) {
			onWrite();
		}
	};

	owner.clear = function mirroredClear(this: Storage): void {
		original.clear.call(this);
		if (this === storage) {
			onWrite();
		}
	};

	return () => {
		owner.clear = original.clear;
		owner.removeItem = original.removeItem;
		owner.setItem = original.setItem;
	};
}

/**
 * Starts mirroring `localStorage` into the main process: once on start, then
 * after every burst of writes, and again when the document goes away.
 * @returns A function that stops mirroring and restores the storage methods.
 */
export function startLocalStorageMirror(): () => void {
	const storage: Storage | undefined = globalThis.localStorage;
	const api = window.ensemblr;
	if (!storage || !api) {
		return () => {};
	}

	let lastMirrored: string | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;

	const flush = async (): Promise<void> => {
		const entries = readEntries(storage);
		const serialized = JSON.stringify(entries);
		if (serialized === lastMirrored) {
			return;
		}

		try {
			const result = await api.mirrorRendererStorage({ entries });
			if (result.status === 'stored') {
				lastMirrored = serialized;
			} else {
				console.warn(
					'[storage-mirror] main kept the older copy:',
					result.reason,
				);
			}
		} catch (error) {
			console.warn('[storage-mirror] could not mirror localStorage', error);
		}
	};

	const scheduleFlush = (): void => {
		if (stopped || timer !== null) {
			return;
		}
		timer = setTimeout(() => {
			timer = null;
			void flush();
		}, FLUSH_DELAY_MS);
	};

	const flushNow = (): void => {
		void flush();
	};

	const restoreStorage = reportStorageWrites(storage, scheduleFlush);
	window.addEventListener('pagehide', flushNow);
	void flush();

	return () => {
		stopped = true;
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		window.removeEventListener('pagehide', flushNow);
		restoreStorage();
	};
}
