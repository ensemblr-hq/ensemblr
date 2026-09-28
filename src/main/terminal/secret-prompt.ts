/**
 * Recognises the prompt a script prints when it stops to read a password —
 * `sudo`, `sudo-rs`, `doas`, `ssh`, `git` over HTTPS. The Setup and Run panes
 * take no keyboard input, so this is what lets the dock offer a masked field in
 * their place. It reads only the line the cursor is sitting on: a prompt is
 * never followed by a newline, and once the program reads the answer and moves
 * on, the next line it prints clears the match.
 */

import { applyCursorMoves, stripTerminalEscapes } from './scrollback-text.ts';

/**
 * Longest line still treated as a prompt. Real prompts are short; a longer line
 * ending in a colon is log output that happens not to have its newline yet.
 */
const MAX_PROMPT_LENGTH = 200;

/**
 * A line that names a password or passphrase and ends in the colon every one of
 * these tools closes its prompt with. The translated keywords cover the locales
 * sudo, ssh, and git ship prompts in that a user is likeliest to run under,
 * including Ensemblr's own Russian and Greek.
 */
const SECRET_PROMPT_PATTERN =
	/(?:password|passphrase|passwort|mot de passe|contraseña|senha|wachtwoord|hasło|пароль|κωδικός).*:$/iu;

/**
 * Reads the prompt a script is waiting on, if the output ends on one.
 * @param tail - The most recent stretch of raw PTY output, escapes included.
 * @returns The prompt line as the terminal shows it, or null when the output is not waiting on a password.
 */
export function detectSecretPrompt(tail: string): string | null {
	const text = stripTerminalEscapes(tail);
	const currentLine = applyCursorMoves(
		text.slice(text.lastIndexOf('\n') + 1),
	).trim();

	if (currentLine.length === 0 || currentLine.length > MAX_PROMPT_LENGTH) {
		return null;
	}

	return SECRET_PROMPT_PATTERN.test(currentLine) ? currentLine : null;
}

/**
 * What an echoed password answer reads as once masked. Fixed rather than one
 * character per character, so the mask does not give away the answer's length.
 */
const ECHOED_SECRET_MASK = '********';

/**
 * Masks the copy of a just-given password that a program reading with echo on
 * prints back — `read -p` without `-s`, say. The echo lands on the answer's own
 * line, ahead of the line break its Enter echoes as, so only the text before
 * the chunk's first line break is touched and the output after it is left
 * exactly as the program wrote it.
 * @param chunk - A chunk of raw PTY output that arrived after the answer was written.
 * @param answer - The password answer, without its Enter.
 * @returns The chunk with the answer masked on its line, and whether that line has ended so the watch can stop.
 */
export function maskEchoedSecret(
	chunk: string,
	answer: string,
): { chunk: string; lineEnded: boolean } {
	const lineEnd = chunk.indexOf('\n');

	if (lineEnd === -1) {
		return {
			chunk: chunk.replaceAll(answer, ECHOED_SECRET_MASK),
			lineEnded: false,
		};
	}

	return {
		chunk:
			chunk.slice(0, lineEnd).replaceAll(answer, ECHOED_SECRET_MASK) +
			chunk.slice(lineEnd),
		lineEnded: true,
	};
}
