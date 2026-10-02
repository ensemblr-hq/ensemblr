/**
 * Removes terminal *report-request* control sequences from replayed scrollback so
 * a reattaching or restoring xterm.js surface never answers them.
 *
 * xterm.js parses whatever is written to it statefully and replies to query
 * sequences — Device Attributes, cursor-position reports, dynamic-color queries,
 * XTVERSION, and friends — by emitting bytes on its data channel. During a live
 * session those replies correctly flow to the running program. But when we replay
 * *historical* output into a freshly spawned shell, the program that issued the
 * query is long gone, so the replies land at the new shell's prompt and echo as
 * gibberish (`ESC[?1;2c`, `ESC]11;rgb:…`, `ESC[24;1R`). Stripping the requests
 * from replay data — never from the live output stream — keeps the prompt clean.
 */

/** Escape (0x1b) and BEL (0x07), built without literal control characters. */
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
// String Terminator for OSC/DCS strings is `ESC \`.
const ST = `${ESC}\\\\`;

/**
 * Union of the control sequences that make a terminal answer back. Each
 * alternative is a request form only, chosen so it can never match the
 * corresponding *set* sequence (dynamic-color sets carry `rgb:…`, not `?`),
 * a window title (OSC 0/1/2 are excluded), or a sixel image (`DCS q`, which
 * lacks the `$`/`+` intermediate the query forms require).
 */
const REPORT_REQUEST_PATTERN = new RegExp(
	[
		// Device Attributes (primary/secondary/tertiary): CSI … c
		`${ESC}\\[[0-9;?>=]*c`,
		// Device Status Report / cursor-position request: CSI … n
		`${ESC}\\[[0-9;?]*n`,
		// Request-mode (DECRQM): CSI [?] … $p
		`${ESC}\\[\\??[0-9;]*\\$p`,
		// XTVERSION: CSI > … q
		`${ESC}\\[>[0-9]*q`,
		// Kitty keyboard-flags query: CSI ? u
		`${ESC}\\[\\?u`,
		// Window-op reports (XTWINOPS size/position queries): CSI 11–21 … t
		`${ESC}\\[(?:1[1-9]|2[01])(?:;[0-9]+)*t`,
		// Dynamic-color queries, including chained/batched forms: OSC 10–19 ; ? (; ?)* ST
		// and OSC 4|5 ; index ; ? (; index ; ?)* ST
		`${ESC}\\](?:1[0-9];\\?(?:;\\?)*|[45];[0-9]+;\\?(?:;[0-9]+;\\?)*)(?:${BEL}|${ST})`,
		// DECRQSS / XTGETTCAP: DCS … $q|+q … ST
		`${ESC}P[0-9;]*[$+]q[^${ESC}]*${ST}`,
	].join('|'),
	'g',
);

/**
 * Strips answer-eliciting query sequences from a chunk of terminal output meant
 * for replay. Pure and idempotent; only replay/restore paths should call it, so
 * live output keeps answering the program that is actually running.
 * @param output - Historical terminal output about to be replayed into xterm.
 * @returns The output with report-request sequences removed.
 */
export function stripReportRequests(output: string): string {
	return output.replace(REPORT_REQUEST_PATTERN, '');
}
