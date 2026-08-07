/**
 * Who chose a chat tab's title, and which writer may overwrite whom.
 *
 * Three producers compete for the same field: the app derives a title from the
 * first prompt, the agent names its own tab through `ensemblr_set_name`, and
 * the user renames it with Pi's `/name`. Ranking them settles every race in one
 * place — a write lands only when its producer outranks (or equals) whoever
 * holds the title now, so a human rename is never clobbered by an agent that
 * gets around to naming its tab three turns later.
 */

/** Who chose a tab's current title. */
export type ChatTitleProvenance = 'auto' | 'agent' | 'user';

/** Authority of each producer; a higher rank overwrites a lower one. */
const PROVENANCE_RANK: Record<ChatTitleProvenance, number> = {
	agent: 1,
	auto: 0,
	user: 2,
};

/**
 * Reads who owns a tab's title, tolerating tabs written before the field
 * existed and values outside the ladder.
 * @param metadata - The chat tab's untyped metadata blob.
 * @returns The recorded provenance, or null when the tab has none.
 */
export function readTitleProvenance(
	metadata: Record<string, unknown>,
): ChatTitleProvenance | null {
	const value = metadata.titleProvenance;
	return value === 'auto' || value === 'agent' || value === 'user'
		? value
		: null;
}

/**
 * Reports whether a producer may set the title a tab currently holds. An unset
 * provenance is the floor, so the first writer always wins.
 * @param current - Who owns the title now, or null when nobody has claimed it.
 * @param next - The producer attempting the write.
 * @returns True when the write should land.
 */
export function canSetTitle(
	current: ChatTitleProvenance | null,
	next: ChatTitleProvenance,
): boolean {
	return PROVENANCE_RANK[next] >= PROVENANCE_RANK[current ?? 'auto'];
}
