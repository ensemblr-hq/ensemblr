import type {
	ComposerThinkingOption,
	ThinkingBarStrength,
} from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';
import { listThinkingLevels } from '@/shared/agent-thinking';

const MAX_STRENGTH = 5;

/**
 * Map a thinking level to its bar strength using the runtime's own ladder, so
 * the five bars fill evenly whichever vocabulary is in play — pi's `minimal` and
 * Claude's `max` both sit at an end of their own list rather than being scored
 * against a shared scale.
 * @param provider - Agent runtime the level belongs to.
 * @param level - The thinking-level id, or null when none is set.
 * @returns The matching bar strength (0 when thinking is off or unrecognised).
 */
export function getThinkingStrength(
	provider: AgentProviderId,
	level: string | null,
): ThinkingBarStrength {
	if (!level) {
		return 0;
	}
	const index = listThinkingLevels(provider).indexOf(level.toLowerCase());
	return index > 0 ? (Math.min(index, MAX_STRENGTH) as ThinkingBarStrength) : 0;
}

/**
 * Computes the next thinking-level id when cycling through the available
 * options, wrapping back to the first once the list runs out.
 * @param options - The runtime's thinking levels, in ladder order.
 * @param value - The currently selected level id, or null when none is set.
 * @returns The next level's id, or null when the runtime offers none.
 */
export function getNextThinkingId(
	options: readonly ComposerThinkingOption[],
	value: string | null,
): string | null {
	if (options.length === 0) {
		return null;
	}
	const currentIndex = Math.max(
		0,
		options.findIndex((option) => option.id === value),
	);
	const nextIndex = (currentIndex + 1) % options.length;
	return options[nextIndex]?.id ?? null;
}
