/** How often a command has been picked, decayed, and when it was last used. */
export interface SlashCommandUsage {
	lastUsedAt: number;
	score: number;
}

/** Decayed pick counts keyed by bare command name, without the leading slash. */
export type SlashCommandUsageMap = Readonly<Record<string, SlashCommandUsage>>;

/** Days after which an unused command's weight halves. */
export const SLASH_COMMAND_USAGE_HALF_LIFE_DAYS = 30;
/** Largest ranking bonus a command's history can earn. */
export const MAX_SLASH_COMMAND_BOOST = 120;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BOOST_SCALE = 24;
const MAX_USAGE_ENTRIES = 500;

/**
 * Reads a command's pick weight as of now, halving it once per half-life since
 * it was last used. Decay is applied on read rather than on a timer, so a
 * command hammered on a finished project fades on its own.
 * @param usage - Stored usage for one command, if any.
 * @param now - Epoch milliseconds to decay towards.
 * @returns The decayed weight, always a finite number and never negative.
 */
export function decayUsageScore(
	usage: SlashCommandUsage | undefined,
	now: number,
): number {
	if (
		!usage ||
		!Number.isFinite(usage.score) ||
		!Number.isFinite(usage.lastUsedAt) ||
		usage.score <= 0
	) {
		return 0;
	}
	const elapsedDays = Math.max(0, (now - usage.lastUsedAt) / MS_PER_DAY);
	const decayed =
		usage.score * 0.5 ** (elapsedDays / SLASH_COMMAND_USAGE_HALF_LIFE_DAYS);
	return Number.isFinite(decayed) ? Math.max(0, decayed) : 0;
}

/**
 * Drops the lowest-weight commands once the map outgrows its cap, so a long-lived
 * install cannot grow the stored history without bound.
 * @param usage - Candidate usage map.
 * @param now - Epoch milliseconds used to rank entries by decayed weight.
 * @returns The map, or a capped copy of it.
 */
function pruneUsage(
	usage: SlashCommandUsageMap,
	now: number,
): SlashCommandUsageMap {
	const commands = Object.keys(usage);
	if (commands.length <= MAX_USAGE_ENTRIES) {
		return usage;
	}
	const kept = commands
		.map((command) => ({
			command,
			weight: decayUsageScore(usage[command], now),
		}))
		.sort((left, right) => right.weight - left.weight)
		.slice(0, MAX_USAGE_ENTRIES);
	return Object.fromEntries(
		kept.map(({ command }) => [command, usage[command]]),
	);
}

/**
 * Records one pick of a command, adding to its decayed weight rather than to a
 * raw count so recent habits outweigh old ones.
 * @param usage - Current usage map.
 * @param command - Bare command name that was picked.
 * @param now - Epoch milliseconds of the pick.
 * @returns A new usage map; the input is never modified.
 */
export function recordSlashCommandUse(
	usage: SlashCommandUsageMap,
	command: string,
	now: number,
): SlashCommandUsageMap {
	if (!command) {
		return usage;
	}
	return pruneUsage(
		{
			...usage,
			[command]: {
				lastUsedAt: now,
				score: decayUsageScore(usage[command], now) + 1,
			},
		},
		now,
	);
}

/**
 * Ranking bonus for a command's pick history, bounded so it can lift a command
 * within its match tier without ever being able to reorder tiers.
 * @param usage - Current usage map.
 * @param command - Bare command name being ranked.
 * @param now - Epoch milliseconds to decay towards.
 * @returns A finite bonus from 0 to `MAX_SLASH_COMMAND_BOOST`.
 */
export function getUsageBoost(
	usage: SlashCommandUsageMap,
	command: string,
	now: number,
): number {
	const weight = decayUsageScore(usage[command], now);
	if (weight <= 0) {
		return 0;
	}
	return Math.min(MAX_SLASH_COMMAND_BOOST, BOOST_SCALE * Math.log2(1 + weight));
}
