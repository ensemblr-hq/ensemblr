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

/**
 * What one string costs inside a serialized payload: its JSON-escaped length,
 * without the quotes. Escaping is why the raw length undercounts — a newline is
 * two characters on the wire, a control byte six.
 * @param text - The string to measure.
 * @returns Its serialized length.
 */
function serializedCost(text: string): number {
	return JSON.stringify(text).length - 2;
}

/**
 * Keeps the end of a text that fits the budget, dropping a contiguous head.
 *
 * The tail-first counterpart to {@link fitRows}, for output where the end is
 * the half worth keeping: a test run's verdict and a build's failure summary
 * both land last. A cut never splits a surrogate pair.
 * @param text - The text to fit.
 * @param budget - Serialized characters the kept text may occupy.
 * @returns The kept tail and how many characters were dropped from the front.
 */
export function fitTail(
	text: string,
	budget: number,
): { kept: string; omitted: number } {
	if (serializedCost(text) <= budget) {
		return { kept: text, omitted: 0 };
	}
	let low = 0;
	let high = text.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (serializedCost(text.slice(middle)) <= budget) {
			high = middle;
		} else {
			low = middle + 1;
		}
	}
	const start = isLowSurrogate(text.charCodeAt(low)) ? low + 1 : low;
	return { kept: text.slice(start), omitted: start };
}

/**
 * Whether a UTF-16 code unit is the second half of a surrogate pair.
 * @param code - The code unit.
 * @returns True for a low surrogate.
 */
function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}
