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
