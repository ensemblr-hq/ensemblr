import type { SlashCommandDescriptor } from '@/renderer/types/workbench';

/**
 * The default ordering rules for the composer's slash menu: which group a
 * command belongs to, whether it describes itself, and the tie-breaks between.
 *
 * These are pure rules over a catalogue, not a hook concern. They live here so
 * both the catalogue hook that normalizes a runtime's answer and the ranking
 * hook that scores it against a query can reach them without importing each
 * other.
 */

/**
 * Ranks slash commands in the default empty-query menu.
 * @param command - Command being ranked.
 * @returns A group rank; lower sorts first.
 */
export function getSlashCommandRank(command: SlashCommandDescriptor): number {
	if (command.source === 'skill' && command.sourceScope === 'project') {
		return 0;
	}
	if (command.source === 'skill') {
		return 1;
	}
	if (command.source === 'extension') {
		return 2;
	}
	if (command.source === 'prompt') {
		return 3;
	}
	return 4;
}

/**
 * Ranks a described command ahead of an otherwise equal bare one.
 * @param command - Command being ranked.
 * @returns 0 when the command describes itself, 1 when it does not.
 */
export function getDescriptionRank(command: SlashCommandDescriptor): number {
	return command.description.trim().length > 0 ? 0 : 1;
}

/**
 * Orders commands by menu group, then by how much each says about itself.
 * @param left - First command.
 * @param right - Second command.
 * @returns Negative when `left` sorts first.
 */
function compareSlashCommands(
	left: SlashCommandDescriptor,
	right: SlashCommandDescriptor,
): number {
	const sourceDiff = getSlashCommandRank(left) - getSlashCommandRank(right);
	if (sourceDiff !== 0) {
		return sourceDiff;
	}
	const descriptionDiff = getDescriptionRank(left) - getDescriptionRank(right);
	if (descriptionDiff !== 0) {
		return descriptionDiff;
	}
	return left.command.localeCompare(right.command);
}

/**
 * Sorts prompt-invokable commands into the default slash-menu groups and keeps
 * one entry per command name.
 *
 * A runtime can report the same command many times: Claude Code resolves a
 * skill once per discovery root it reaches, so a single `/code-review` arrives
 * four times, and pi reports a skill once per scope it is installed in. The
 * menu identifies a row by its command name, so repeats collide into one React
 * key and the highlight stops tracking the row under the pointer. Sorting first
 * means the surviving entry is the best-ranked, most descriptive one.
 * @param commands - Raw catalogue as the runtime reported it.
 * @returns Menu-ordered commands with repeated names removed.
 */
export function normalizeSlashCommands(
	commands: readonly SlashCommandDescriptor[],
): SlashCommandDescriptor[] {
	const byName = new Map<string, SlashCommandDescriptor>();
	for (const command of [...commands].sort(compareSlashCommands)) {
		if (!byName.has(command.command)) {
			byName.set(command.command, command);
		}
	}
	return [...byName.values()];
}
