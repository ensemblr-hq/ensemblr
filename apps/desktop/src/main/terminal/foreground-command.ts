/**
 * Reads what an interactive terminal is currently running from its PTY's
 * foreground process group, so a dock tab can name the command while it runs and
 * revert to its own label when it finishes.
 *
 * The PTY, not the keystrokes, is the source: a renderer watching input can see
 * a command submitted but has no signal for one completing, and shell
 * integration (OSC 133) would mean injecting hooks into the user's rc files.
 * `tcgetpgrp` needs nothing from the shell and is right for every one of them.
 */

/**
 * Reduces a PTY's foreground process name to the command a tab should show.
 * A shell running nothing keeps itself in the foreground, so a name matching the
 * session's own shell means idle rather than a command called `fish`.
 * @param processName - Foreground process name the PTY reports, if any.
 * @param shellFile - Shell the session spawned, as a path or bare name.
 * @returns The running command's name, or null when nothing but the shell is running.
 */
export function resolveForegroundCommand(
	processName: string | null | undefined,
	shellFile: string,
): string | null {
	const foreground = commandName(processName ?? '');
	if (!foreground) {
		return null;
	}
	return foreground.toLowerCase() === commandName(shellFile).toLowerCase()
		? null
		: foreground;
}

/**
 * Reduces whatever a platform reports to the bare command name. Backends differ
 * on whether they hand back `npm`, `/usr/bin/npm`, or the `-zsh` a login shell
 * calls itself, and a tab wants the same short word from all three.
 * @param value - A process name, path, or shell file.
 * @returns The bare command name.
 */
function commandName(value: string): string {
	const trimmed = value.trim();
	const name = trimmed.split('/').pop() ?? trimmed;
	return (name.startsWith('-') ? name.slice(1) : name).trim();
}
