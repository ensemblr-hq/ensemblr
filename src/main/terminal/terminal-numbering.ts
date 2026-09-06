/**
 * Numbering for the workspace's interactive dock terminals, so unnamed tabs read
 * `Terminal 1`, `Terminal 2`, and so on. Script and agent sessions are not
 * numbered at all — they render in their own fixed tabs — so nothing here knows
 * about session kinds; the caller decides which sessions hold a number.
 */

/**
 * Picks the number a new dock terminal should take: the lowest positive integer
 * no live terminal already holds. Filling gaps rather than counting up keeps a
 * dock that has been open all day from reaching `Terminal 47`, and assigning it
 * once at creation is what stops closing one tab from renumbering the rest.
 * @param taken - Numbers held by the workspace's live dock terminals.
 * @returns The lowest unheld number, starting at 1.
 */
export function allocateTerminalNumber(taken: Iterable<number>): number {
	const held = new Set(taken);
	let candidate = 1;
	while (held.has(candidate)) {
		candidate += 1;
	}
	return candidate;
}
