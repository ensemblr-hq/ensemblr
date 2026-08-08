import { atom } from 'jotai';
import { atomWithStorage, createJSONStorage } from 'jotai/utils';

import type { SlashCommandUsageMap } from './usage';

/** localStorage key holding the persisted slash-command usage envelope. */
const SLASH_COMMAND_USAGE_STORAGE_KEY = 'ensemblr_slash_command_usage';
/** Schema version embedded in the persisted slash-command usage envelope. */
const SLASH_COMMAND_USAGE_STORAGE_VERSION = 1;

/** Versioned localStorage envelope wrapping the usage map. */
interface SlashCommandUsageEnvelope {
	entries: SlashCommandUsageMap;
	version: number;
}

const EMPTY_ENVELOPE: SlashCommandUsageEnvelope = {
	entries: {},
	version: SLASH_COMMAND_USAGE_STORAGE_VERSION,
};

// No-arg `createJSONStorage` uses the default localStorage shim, which
// gracefully degrades to a no-op when `localStorage` is missing (tests, SSR).
const envelopeStorage = createJSONStorage<SlashCommandUsageEnvelope>();

/** Versioned usage envelope persisted to localStorage; resets when the stored schema version mismatches. */
const slashCommandUsageEnvelopeAtom =
	atomWithStorage<SlashCommandUsageEnvelope>(
		SLASH_COMMAND_USAGE_STORAGE_KEY,
		EMPTY_ENVELOPE,
		{
			...envelopeStorage,
			/** Reads the stored envelope, falling back to empty when it is missing or its schema version mismatches. */
			getItem: (key, initialValue) => {
				const stored = envelopeStorage.getItem(key, initialValue);
				// Reset on missing or mismatched version so a schema change can't
				// resurface as half-decoded entries.
				if (
					!stored ||
					stored.version !== SLASH_COMMAND_USAGE_STORAGE_VERSION ||
					typeof stored.entries !== 'object' ||
					stored.entries === null
				) {
					return EMPTY_ENVELOPE;
				}
				return stored;
			},
		},
		{ getOnInit: true },
	);

/**
 * How often each slash command has been picked from the composer menu, decayed
 * over time and keyed by bare command name. Tallied globally rather than per
 * workspace or per runtime so a habit carries into a brand-new workspace
 * immediately. Persisted to localStorage only; emits no telemetry.
 */
export const slashCommandUsageAtom = atom<
	SlashCommandUsageMap,
	[
		| SlashCommandUsageMap
		| ((prev: SlashCommandUsageMap) => SlashCommandUsageMap),
	],
	void
>(
	(get) => get(slashCommandUsageEnvelopeAtom).entries,
	(get, set, update) => {
		const previous = get(slashCommandUsageEnvelopeAtom).entries;
		const next = typeof update === 'function' ? update(previous) : update;
		set(slashCommandUsageEnvelopeAtom, {
			entries: next,
			version: SLASH_COMMAND_USAGE_STORAGE_VERSION,
		});
	},
);
