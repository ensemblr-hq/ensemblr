/**
 * Canonical parsing for the slash commands a user types into the composer,
 * shared across runtimes.
 *
 * Pi expands `/skill:name args` into `<skill name="…">…body…</skill> args`
 * before echoing the prompt back and persisting it. Both the main-process echo
 * matcher and the renderer timeline need to recognize that the raw command and
 * its expansion are the same invocation — the matcher so it retires the queued
 * prompt instead of re-emitting a duplicate on shutdown, the renderer so it can
 * reconcile the two. Deterministic tab titling needs the same split for a
 * different reason: the command itself is scaffolding, and only its arguments
 * describe the work. This module is the one place that knows both forms.
 */

/**
 * Matches Pi's expanded `<skill>` block, capturing the skill name, the block
 * body, and the arguments trailing it. Exported so the renderer's parser reads
 * this pattern rather than maintaining a second copy that could silently desync
 * from it — this module is the only place that knows the wire format.
 */
export const EXPANDED_SKILL_INVOCATION =
	/^\s*<skill name="([^"]*)" location="[^"]*">\n([\s\S]*?)\n<\/skill>\s*([\s\S]*)$/;

/** Stand-in name for a `<skill>` block Pi expanded with an empty `name`. */
export const FALLBACK_SKILL_NAME = 'skill';

/**
 * Matches a typed slash command and its arguments. The name must be followed by
 * whitespace or end of input, which is what keeps a path like `/usr/bin/env`
 * from reading as the command `usr`.
 */
const TYPED_SLASH_COMMAND = /^\/([A-Za-z0-9][\w:-]*)(?=\s|$)([\s\S]*)$/;

/** Prefix marking a slash command as a skill invocation rather than a builtin. */
const SKILL_COMMAND_PREFIX = 'skill:';

/** A slash command split into the command name and everything after it. */
export interface ParsedSlashCommand {
	/** Arguments trailing the command, trimmed; empty when invoked bare. */
	args: string;
	/** Command name without its leading slash, e.g. `plan` or `skill:caveman`. */
	name: string;
}

/**
 * Splits a leading slash command off a prompt, reading Pi's expanded `<skill>`
 * block as the invocation it came from.
 * @param prompt - The prompt text, in either the typed or the expanded form
 * @returns The command and its arguments, or null when the prompt invokes none
 */
export function parseSlashCommand(prompt: string): ParsedSlashCommand | null {
	const expanded = EXPANDED_SKILL_INVOCATION.exec(prompt);
	if (expanded) {
		return {
			args: (expanded[3] ?? '').trim(),
			name: `${SKILL_COMMAND_PREFIX}${expanded[1] || FALLBACK_SKILL_NAME}`,
		};
	}
	const typed = TYPED_SLASH_COMMAND.exec(prompt.trim());
	if (!typed) {
		return null;
	}
	return { args: (typed[2] ?? '').trim(), name: typed[1] ?? '' };
}

/**
 * Reduces a skill invocation to a stable key that matches across its typed and
 * expanded forms. Slash commands that invoke no skill have no key.
 * @param prompt - The prompt text, in either the typed or the expanded form
 * @returns The `skill:name` key (trimmed arguments appended when present), or null when the prompt invokes no skill
 */
export function skillInvocationKey(prompt: string): string | null {
	const command = parseSlashCommand(prompt);
	if (!command?.name.startsWith(SKILL_COMMAND_PREFIX)) {
		return null;
	}
	return command.args ? `${command.name}\n${command.args}` : command.name;
}
