/**
 * The one row-fitting rule every port shares when a result is larger than a
 * single tool call can carry.
 *
 * Ports must fit their answers to `MAX_AGENT_PAYLOAD_CHARS` and report what
 * they cut, so each one needs the same greedy head-first trim. Keeping it here
 * rather than per port means the cost model — a row costs its serialized length
 * plus the comma that would join it — is stated once, and a port that sheds in
 * stages measures a row exactly as the port beside it does.
 */

/**
 * Keeps as many rows as the budget leaves room for, dropping a contiguous tail.
 *
 * Greedy from the front rather than proportional: every caller hands rows in an
 * order where the head is the half worth keeping — Linear's most recently
 * updated issues first, a diagram's own component order — so a contiguous head
 * stays coherent in a way an arbitrary subset would not.
 * @param rows - Rows in the order they should survive.
 * @param budget - Characters the kept rows may occupy in total.
 * @returns The rows that fit, how many were dropped, and the characters spent.
 */
export function fitRows<T>(
	rows: readonly T[],
	budget: number,
): { kept: readonly T[]; omitted: number; spent: number } {
	const kept: T[] = [];
	let spent = 0;
	for (const row of rows) {
		const cost = JSON.stringify(row).length + 1;
		if (spent + cost > budget) {
			break;
		}
		kept.push(row);
		spent += cost;
	}
	return { kept, omitted: rows.length - kept.length, spent };
}
