import { useAtomValue } from 'jotai';
import { useMemo, useState } from 'react';

import {
	type FuzzyMatch,
	fuzzyMatch,
} from '@/renderer/lib/workbench/fuzzy-score';
import {
	getDescriptionRank,
	getSlashCommandRank,
} from '@/renderer/lib/workbench/slash-command-order';
import {
	getUsageBoost,
	type SlashCommandUsageMap,
	slashCommandUsageAtom,
} from '@/renderer/state/slash-commands';
import type {
	SlashCommandDescriptor,
	SlashCommandMatch,
} from '@/renderer/types/workbench';

/** How many rows the slash menu will render at most. */
const DEFAULT_SLASH_MATCH_LIMIT = 80;

/** A candidate command with its match and the ranking bonus its history earned. */
interface ScoredSlashCommand {
	boost: number;
	item: SlashCommandDescriptor;
	match: FuzzyMatch;
}

/** The usage snapshot a single opening of the menu ranks against. */
interface UsageSnapshot {
	now: number;
	usage: SlashCommandUsageMap;
}

/**
 * Orders candidates by match tier first, so a command's pick history can lift it
 * within a tier but can never promote a weak subsequence hit above a real prefix
 * match. Within a tier, history is added to the match score — enough to beat the
 * small positional differences the substring tier scores by — and the catalogue's
 * own group order breaks whatever remains.
 * @param left - First candidate.
 * @param right - Second candidate.
 * @returns Negative when `left` sorts first.
 */
function compareScoredSlashCommands(
	left: ScoredSlashCommand,
	right: ScoredSlashCommand,
): number {
	const tierDiff = right.match.tier - left.match.tier;
	if (tierDiff !== 0) {
		return tierDiff;
	}
	const weightDiff =
		right.match.score + right.boost - (left.match.score + left.boost);
	if (weightDiff !== 0) {
		return weightDiff;
	}
	const sourceDiff =
		getSlashCommandRank(left.item) - getSlashCommandRank(right.item);
	if (sourceDiff !== 0) {
		return sourceDiff;
	}
	const descriptionDiff =
		getDescriptionRank(left.item) - getDescriptionRank(right.item);
	if (descriptionDiff !== 0) {
		return descriptionDiff;
	}
	return left.item.command.localeCompare(right.item.command);
}

/**
 * Scores, ranks, and truncates the slash catalogue against a query, reporting
 * which characters of each command name matched.
 *
 * With no query every command ties on match, so pick history alone decides the
 * order — which is what puts the commands someone actually uses at the top of
 * the menu the moment `/` is typed.
 * @param commands - The runtime's catalogue, already normalized.
 * @param query - Text typed after the slash.
 * @param usage - Decayed pick history to rank by.
 * @param now - Epoch milliseconds the history is decayed towards.
 * @param limit - Maximum number of rows to return.
 * @returns The best matches, ordered best first.
 */
export function rankSlashMatches(
	commands: readonly SlashCommandDescriptor[],
	query: string,
	usage: SlashCommandUsageMap,
	now: number,
	limit = DEFAULT_SLASH_MATCH_LIMIT,
): SlashCommandMatch[] {
	const scored: ScoredSlashCommand[] = [];
	for (const item of commands) {
		const match = fuzzyMatch(item.command, query);
		if (match.score <= 0) {
			continue;
		}
		scored.push({
			boost: getUsageBoost(usage, item.command, now),
			item,
			match,
		});
	}
	scored.sort(compareScoredSlashCommands);
	return scored
		.slice(0, limit)
		.map(({ item, match }) => ({ item, ranges: match.ranges }));
}

/**
 * Takes one usage snapshot per opening of the menu, so recording a pick cannot
 * reorder the list that is still on screen underneath the keyboard highlight.
 * @param menuOpen - Whether the slash menu is open right now.
 * @returns The snapshot to rank against, or null while the menu is shut.
 */
function useUsageSnapshot(menuOpen: boolean): UsageSnapshot | null {
	const usage = useAtomValue(slashCommandUsageAtom);
	const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);

	// Adjusted during render for the same reason as the catalogue's open latch:
	// an effect would commit one frame ranked against nothing.
	if (menuOpen && !snapshot) {
		setSnapshot({ now: Date.now(), usage });
	}
	if (!menuOpen && snapshot) {
		setSnapshot(null);
	}

	return menuOpen ? (snapshot ?? { now: Date.now(), usage }) : null;
}

/**
 * Memoized slash-command matches for the composer menu, ranked by match quality
 * and then by how often the command is picked.
 * @param commands - The runtime's catalogue, already normalized.
 * @param query - Text typed after the slash.
 * @param menuOpen - Whether the composer's slash menu is currently open.
 * @param limit - Maximum number of rows to return.
 * @returns The rows to render, ordered best first.
 */
export function useSlashMatches(
	commands: readonly SlashCommandDescriptor[],
	query: string,
	menuOpen: boolean,
	limit = DEFAULT_SLASH_MATCH_LIMIT,
): SlashCommandMatch[] {
	const snapshot = useUsageSnapshot(menuOpen);
	return useMemo(
		() =>
			snapshot
				? rankSlashMatches(commands, query, snapshot.usage, snapshot.now, limit)
				: [],
		[commands, query, snapshot, limit],
	);
}
