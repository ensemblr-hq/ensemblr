/**
 * Turns raw PTY scrollback into text something other than a terminal emulator
 * can read. The dock renders scrollback through xterm.js, which interprets
 * escape sequences as colour and cursor movement; an agent reading the same
 * buffer over agent-control gets them verbatim, so one `Local:
 * http://localhost:5199/` arrives buried in ESC-bracket colour codes, the
 * ESC-bracket cursor-home-and-erase pair a full-screen repaint opens with, and
 * the blank-line runs that repaint leaves behind.
 *
 * This is a reader for that audience, not an emulator: it drops the sequences
 * rather than applying them, and resolves only the cursor moves that change what
 * the text says — a carriage return rewriting the line it sits on, and the
 * backspaces a spinner or a percentage counter walks back over.
 *
 * One thing it cannot recover: the scrollback buffer trims from the front, so a
 * filled one begins partway through whatever the PTY was writing. The opening
 * line of a long buffer is a fragment, and a colour code cut before its `ESC`
 * leaves its parameter bytes there as ordinary text.
 */

const ESC = '\\u001b';
const BEL = '\\u0007';

/** CSI sequences: colours, cursor moves, erases — `ESC [ ... final`. */
const CSI_PATTERN = new RegExp(`${ESC}\\[[0-9;:<=>?]*[ -/]*[@-~]`, 'g');

/** OSC sequences (window title, hyperlinks, shell integration), BEL- or ST-terminated. */
const OSC_PATTERN = new RegExp(
	`${ESC}\\][^${ESC}${BEL}]*(?:${BEL}|${ESC}\\\\)?`,
	'g',
);

/** DCS/SOS/PM/APC strings, which run until a string terminator. */
const STRING_COMMAND_PATTERN = new RegExp(
	`${ESC}[P^_X][\\s\\S]*?(?:${ESC}\\\\|${BEL})`,
	'g',
);

/**
 * A sequence the read caught mid-write, which has an `ESC` and its parameters
 * but not yet the byte that ends it. Stripped before the two-character escape
 * pass, which would otherwise match the `ESC [` prefix on its own and leave the
 * parameters behind as literal digits an agent cannot tell from real output.
 * Unterminated OSC needs no alternative here: {@link OSC_PATTERN} takes its
 * terminator as optional and has already consumed it.
 */
const TRUNCATED_SEQUENCE_PATTERN = new RegExp(
	`${ESC}(?:\\[[0-9;:<=>?]*[ -/]*|[P^_X][\\s\\S]*|[ -/]*)$`,
);

/** Two-character escapes: charset selection, keypad mode, index, reset. */
const SHORT_ESCAPE_PATTERN = new RegExp(`${ESC}[ -/]*[0-~]`, 'g');

/**
 * Character codes carrying no meaning in plain text: the C0 controls and DEL.
 * The gaps in these ranges are the four that do — backspace (8), tab (9),
 * newline (10), and carriage return (13). Tab and newline are the text's own
 * structure; the other two are cursor moves, resolved per line below.
 */
const NON_TEXT_CONTROL_RANGES = [
	[0, 7],
	[11, 12],
	[14, 31],
	[127, 127],
] as const;

const CONTROL_CHARACTER_PATTERN = new RegExp(
	`[${NON_TEXT_CONTROL_RANGES.map(
		([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`,
	).join('')}]`,
	'g',
);

const BACKSPACE = String.fromCharCode(8);

const TRAILING_SPACE_PATTERN = /[ \t]+$/;

const LINE_ENDING_PATTERN = /\r\n/g;

const BLANK_LINE_RUN_PATTERN = /\n{3,}/g;

/**
 * Replays one line's writes into the cells they landed in, walking the cursor
 * back on each backspace. This is how npm, pip, cargo and docker repaint a
 * percentage or a spinner in place, and dropping the backspaces instead would
 * leave both the old text and the text that covered it — `100%done` for output
 * a terminal shows as `done`.
 * @param segment - One line's worth of writes, with its carriage returns already resolved.
 * @returns The characters left standing, in the columns they ended up in.
 */
function paintBackspaces(segment: string): string {
	if (!segment.includes(BACKSPACE)) {
		return segment;
	}
	const cells: string[] = [];
	let column = 0;
	for (const character of segment) {
		if (character === BACKSPACE) {
			column = Math.max(0, column - 1);
			continue;
		}
		cells[column] = character;
		column += 1;
	}
	return cells.join('');
}

/**
 * Resolves the cursor moves inside one line: everything before the last
 * carriage return was painted over and never seen, and the backspaces in what
 * remains walk back over what they cover.
 * @param line - One line of escape-stripped output.
 * @returns The text the line actually ended up showing.
 */
function applyCursorMoves(line: string): string {
	const repainted = line.slice(line.lastIndexOf('\r') + 1);
	return paintBackspaces(repainted).replace(TRAILING_SPACE_PATTERN, '');
}

/**
 * Renders raw terminal scrollback as readable text: escape sequences dropped,
 * overwritten line fragments resolved, and repaint blank-line runs collapsed to
 * one blank line.
 * @param raw - Scrollback exactly as the PTY produced it.
 * @returns The readable rendering, which is empty when the buffer held only escapes.
 */
export function toReadableScrollback(raw: string): string {
	const stripped = raw
		.replace(STRING_COMMAND_PATTERN, '')
		.replace(OSC_PATTERN, '')
		.replace(CSI_PATTERN, '')
		.replace(TRUNCATED_SEQUENCE_PATTERN, '')
		.replace(SHORT_ESCAPE_PATTERN, '')
		.replace(CONTROL_CHARACTER_PATTERN, '');

	return stripped
		.replace(LINE_ENDING_PATTERN, '\n')
		.split('\n')
		.map(applyCursorMoves)
		.join('\n')
		.replace(BLANK_LINE_RUN_PATTERN, '\n\n')
		.trim();
}
