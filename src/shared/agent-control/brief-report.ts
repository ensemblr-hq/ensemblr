/**
 * Shortens a child's report for an orchestrator that asked `waitForAgents` for
 * brief reports. Delegation buys parallelism but no context savings while every
 * child's whole final turn lands in the orchestrator's window, and a wide fan-out
 * pays that per child. Spending the whole budget is what makes the short form
 * usable: the playbook has children lead with the answer and follow with the
 * evidence, so the opening carries the finding and the tail is the part worth
 * re-fetching on demand. A tidy paragraph or line boundary is taken only when it
 * still leaves most of that budget standing.
 */

/** How much of a child's report a brief wait keeps. */
export const BRIEF_REPORT_CHARS = 1_200;

/**
 * Renders the pointer that tells the model where the rest of the report lives.
 * A boolean flag is not enough — models act on the wording.
 * @param piSessionId - The child whose report was shortened.
 * @returns The sentence appended to the shortened report.
 */
function fetchPointer(piSessionId: string): string {
	return `… report shortened. Read it in full with ensemblr_get_last_message({ piSessionId: "${piSessionId}" }).`;
}

/** The smallest share of the budget a boundary may leave to be worth cutting on. */
const MIN_BUDGET_SHARE = 0.5;

/**
 * Finds the break to cut at: the last paragraph break, else the last line break,
 * else the raw budget. A break is only worth taking when it still leaves at least
 * half the budget — a report whose sole blank line is an opening heading would
 * otherwise be cut down to that heading, costing the orchestrator a round trip to
 * read what the budget could have carried outright.
 * @param report - The full report text.
 * @param budget - Characters the short form may keep.
 * @returns The index to slice to.
 */
function cutPoint(report: string, budget: number): number {
	const head = report.slice(0, budget);
	const floor = budget * MIN_BUDGET_SHARE;
	const paragraph = head.lastIndexOf('\n\n');
	if (paragraph >= floor) {
		return paragraph;
	}
	const line = head.lastIndexOf('\n');
	return line >= floor ? line : budget;
}

/** A shortened report and whether shortening actually happened. */
export interface BriefReport {
	text: string | null;
	truncated: boolean;
}

/**
 * Shortens one child's report to the brief budget, appending the pointer that
 * recovers the rest. A report already inside the budget is returned untouched,
 * and so is a child that filed none.
 * @param report - The child's full report, or null when it filed none.
 * @param piSessionId - The child the report came from.
 * @param budget - Characters to keep; defaults to {@link BRIEF_REPORT_CHARS}.
 * @returns The text to hand the orchestrator, flagged when it was shortened.
 */
export function briefReport(
	report: string | null,
	piSessionId: string,
	budget: number = BRIEF_REPORT_CHARS,
): BriefReport {
	if (report === null || report.length <= budget) {
		return { text: report, truncated: false };
	}
	const head = report.slice(0, cutPoint(report, budget)).trimEnd();
	return {
		text: `${head}\n\n${fetchPointer(piSessionId)}`,
		truncated: true,
	};
}
