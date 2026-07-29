import type { ThinkingBarStrength } from '@/renderer/types/workbench';

const STRENGTH_BY_LEVEL: Record<string, ThinkingBarStrength> = {
	'extra-high': 5,
	'extra high': 5,
	high: 4,
	low: 2,
	medium: 3,
	minimal: 1,
	none: 0,
	off: 0,
	xhigh: 5,
};

/**
 * Map a thinking-level label to its bar strength, defaulting to medium (3) for unknown levels.
 * @param level - The thinking-level id, or null when none is set.
 * @returns The matching bar strength (0 when no level is set).
 */
export function getThinkingStrength(level: string | null): ThinkingBarStrength {
	if (!level) {
		return 0;
	}
	const key = level.toLowerCase();
	return STRENGTH_BY_LEVEL[key] ?? 3;
}
