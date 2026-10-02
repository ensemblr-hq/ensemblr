import type { RendererStorageSnapshot } from '../shared/ipc/contracts/renderer-storage';

/**
 * What replaying the mirror into a document's storage did, for the caller to
 * log. `rolled-back` is the one that matters: the seed was refused partway
 * through and the storage was emptied again, so main sees an empty snapshot,
 * keeps its copy, and offers the seed once more on the next launch.
 */
export type SeedOutcome =
	| 'already-populated'
	| 'no-seed'
	| 'rolled-back'
	| 'seeded'
	| 'unavailable';

/**
 * Replays the main process's mirror of `localStorage` into a document whose own
 * storage is empty, before any page script can read a preference and find
 * nothing there.
 *
 * This is what carries the user's preferences across a change of the renderer's
 * origin — they are keyed by origin, and the packaged renderer moves off `file:`
 * once `GrantFileProtocolExtraPrivileges` is closed. A document that already has
 * storage is left alone, and main only marks the mirror as replayed once the
 * renderer's own snapshot proves the entries arrived, so a seed that fails here
 * is retried on the next launch rather than lost.
 *
 * The replay is all-or-nothing. A half-applied seed is the one state that would
 * destroy the mirror: main would see a snapshot missing the seeded keys, refuse
 * it for the session, and then accept that same reduced storage on the next
 * launch — when the document is no longer empty and no seed is offered. Undoing
 * a failed replay leaves the document in the state the seed is designed to
 * recognise.
 * @param input - The storage area to fill and the call that fetches the mirror.
 * @returns What the replay did.
 */
export function seedRendererStorage({
	requestSeed,
	storage,
}: {
	requestSeed: () => RendererStorageSnapshot | null | undefined;
	storage: Storage;
}): SeedOutcome {
	try {
		if (storage.length > 0) {
			return 'already-populated';
		}

		const entries = requestSeed()?.entries;
		if (!entries || Object.keys(entries).length === 0) {
			return 'no-seed';
		}

		try {
			for (const [key, value] of Object.entries(entries)) {
				storage.setItem(key, value);
			}
		} catch (error) {
			storage.clear();
			console.warn(
				'[renderer-storage] rolled back a partial seed; it will be retried',
				error,
			);
			return 'rolled-back';
		}

		return 'seeded';
	} catch (error) {
		console.warn('[renderer-storage] could not seed localStorage', error);
		return 'unavailable';
	}
}
