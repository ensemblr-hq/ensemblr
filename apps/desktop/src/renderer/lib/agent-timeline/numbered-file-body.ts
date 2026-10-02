/** A `cat -n` gutter: padding, the line number, then a tab or an arrow. */
const NUMBERED_LINE = /^[ \t]*(\d+)(?:\t|→)(.*)$/;

/** A file body whose own gutter was stripped, and the line it starts at. */
export interface NumberedFileBody {
	code: string;
	startLine: number;
}

/** The numbered run opening a result: its unnumbered lines and first number. */
interface NumberedPrefix {
	contents: readonly string[];
	startLine: number;
}

/**
 * Strips the line-number gutter a `read` tool bakes into its result — Claude
 * Code returns file content in `cat -n` form — so the card's own gutter does not
 * paint a second column of numbers beside it.
 *
 * The body must open with a numbered line and its numbers must run
 * consecutively, so a file that merely opens with digits and a tab, as a TSV
 * does, reads as the content it is. Whatever follows that run is harness chatter
 * the tool appended — a `<system-reminder>`, a truncation notice — and is
 * dropped rather than shown as file content. A tail that numbers lines of its
 * own is a broken gutter rather than chatter, and refuses the whole text.
 * @param text - The read tool's result text
 * @returns The unnumbered body and its first line number, or null when the text
 * carries no gutter of its own
 */
export function parseNumberedFileBody(text: string): NumberedFileBody | null {
	if (text.length === 0) {
		return null;
	}
	const endsWithNewline = text.endsWith('\n');
	const lines = (endsWithNewline ? text.slice(0, -1) : text).split('\n');
	const prefix = readNumberedPrefix(lines);
	if (prefix === null) {
		return null;
	}
	const trailer = lines.slice(prefix.contents.length);
	if (trailer.some((line) => NUMBERED_LINE.test(line))) {
		return null;
	}
	const code = prefix.contents.join('\n');
	const terminated = trailer.length > 0 || endsWithNewline;
	return {
		code: terminated ? `${code}\n` : code,
		startLine: prefix.startLine,
	};
}

/**
 * Reads the consecutively numbered run a result opens with, stopping at the
 * first line that breaks it.
 * @param lines - The result's lines, without their terminator
 * @returns The run's contents and first line number, or null when the result
 * does not open with a numbered line
 */
function readNumberedPrefix(lines: readonly string[]): NumberedPrefix | null {
	const contents: string[] = [];
	let startLine: number | null = null;
	let expected: number | null = null;

	for (const line of lines) {
		const match = NUMBERED_LINE.exec(line);
		if (match === null) {
			break;
		}
		const number = Number(match[1]);
		if (expected !== null && number !== expected) {
			break;
		}
		startLine ??= number;
		expected = number + 1;
		contents.push(match[2] ?? '');
	}

	return startLine === null ? null : { contents, startLine };
}
