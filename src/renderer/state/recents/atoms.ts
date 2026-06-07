import { atom } from 'jotai';
import { atomWithStorage, createJSONStorage } from 'jotai/utils';

import type { RecentProject } from '@/renderer/types/workbench';

export const RECENT_PROJECTS_STORAGE_KEY = 'ensemble_recent_projects';
export const RECENT_PROJECTS_STORAGE_VERSION = 1;

interface RecentProjectsStorageEnvelope {
	entries: RecentProject[];
	version: number;
}

const EMPTY_ENVELOPE: RecentProjectsStorageEnvelope = {
	entries: [],
	version: RECENT_PROJECTS_STORAGE_VERSION,
};

// No-arg `createJSONStorage` uses the default localStorage shim, which
// gracefully degrades to a no-op when `localStorage` is missing (tests, SSR).
const envelopeStorage = createJSONStorage<RecentProjectsStorageEnvelope>();

const recentProjectsEnvelopeAtom =
	atomWithStorage<RecentProjectsStorageEnvelope>(
		RECENT_PROJECTS_STORAGE_KEY,
		EMPTY_ENVELOPE,
		{
			...envelopeStorage,
			getItem: (key, initialValue) => {
				const stored = envelopeStorage.getItem(key, initialValue);
				// Reset on missing or mismatched version so a schema change can't
				// resurface as half-decoded entries.
				if (!stored || stored.version !== RECENT_PROJECTS_STORAGE_VERSION) {
					return EMPTY_ENVELOPE;
				}
				return stored;
			},
		},
		{ getOnInit: true },
	);

/**
 * Recently opened local projects, persisted to localStorage only. Recents stay
 * on-device and emit no telemetry. Empty by default — fixtures live in
 * `mocks/workbench` and are only seeded through explicit mock entry points.
 */
export const recentProjectsAtom = atom<
	RecentProject[],
	[RecentProject[] | ((prev: RecentProject[]) => RecentProject[])],
	void
>(
	(get) => get(recentProjectsEnvelopeAtom).entries,
	(get, set, update) => {
		const previous = get(recentProjectsEnvelopeAtom).entries;
		const next = typeof update === 'function' ? update(previous) : update;
		set(recentProjectsEnvelopeAtom, {
			entries: next,
			version: RECENT_PROJECTS_STORAGE_VERSION,
		});
	},
);
