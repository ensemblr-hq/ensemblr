/**
 * Carries a skill activation through the AI SDK's message-part union. When a
 * user invokes `/skill:name`, Pi expands the whole `SKILL.md` into the prompt;
 * the mapper lifts that out and drops this lightweight marker into the assistant
 * turn instead, so the skill reads as one "Skill activated" row of activity
 * rather than a wall of text standing above the turn.
 */

import type {
	AgentSkillPartData,
	UIMessagePart,
} from '@/renderer/types/agent-timeline';

/** Part type identifying a skill-activation marker on a UI message. */
const PI_SKILL_PART_TYPE = 'data-pi-skill';

/**
 * Wraps a skill activation as a message part.
 * @param name - The invoked skill's name
 * @returns The `data-pi-skill` part carrying it
 */
export function buildSkillPart(name: string): UIMessagePart {
	return { data: { name }, type: PI_SKILL_PART_TYPE };
}

/**
 * Reads a skill activation back off a message part.
 * @param part - The part to inspect
 * @returns The skill marker, or null when the part carries something else
 */
export function skillPartDataOf(
	part: UIMessagePart,
): AgentSkillPartData | null {
	if (part.type !== PI_SKILL_PART_TYPE || !('data' in part)) {
		return null;
	}
	const data = part.data;
	if (typeof data !== 'object' || data === null) {
		return null;
	}
	const { name } = data as Record<string, unknown>;
	if (typeof name !== 'string' || name.length === 0) {
		return null;
	}
	return { name };
}
