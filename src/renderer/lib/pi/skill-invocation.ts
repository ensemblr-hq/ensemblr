/**
 * Splits a persisted user prompt into the skill it invoked and the arguments
 * left over.
 *
 * Pi expands `/skill:name args` client-side into
 * `<skill name="…" location="…">…body…</skill>` followed by the arguments, then
 * echoes the whole thing back as the user's prompt. Rendered verbatim that puts
 * an entire SKILL.md in the chat, so the block is lifted out here and shown as a
 * collapsed row instead.
 */

import type {
	ParsedSkillInvocation,
	ParsedSkillPrompt,
} from '@/renderer/types/pi-timeline';

import {
	EXPANDED_SKILL_INVOCATION,
	FALLBACK_SKILL_NAME,
} from '@/shared/pi-skill-invocation';

export { skillInvocationKey } from '@/shared/pi-skill-invocation';

/**
 * Lifts an expanded skill block out of a persisted prompt. Falls back to a
 * placeholder name when Pi expands a block with an empty `name`, since the
 * empty string would render as the malformed command `/skill:` and be rejected
 * by the skill-part guard, losing the activation entirely.
 * @param prompt - The raw persisted prompt text
 * @returns The invoked skill and the remaining prompt text
 */
export function parseSkillInvocation(prompt: string): ParsedSkillPrompt {
	const match = EXPANDED_SKILL_INVOCATION.exec(prompt);
	if (!match) {
		return { skill: null, text: prompt };
	}
	const [, name, content, rest] = match;
	return {
		skill: {
			content: (content ?? '').trim(),
			name: name || FALLBACK_SKILL_NAME,
		} satisfies ParsedSkillInvocation,
		text: (rest ?? '').trim(),
	};
}

/**
 * Rebuilds the `/skill:name args` command a user typed before Pi expanded it
 * into a `<skill>` block, so the timeline can show the invocation as the prompt.
 * @param name - The invoked skill's name
 * @param args - The arguments the user passed, if any
 * @returns The `/skill:name` command, with trimmed arguments appended when present
 */
export function skillCommandText(name: string, args: string): string {
	const trimmed = args.trim();
	return trimmed ? `/skill:${name} ${trimmed}` : `/skill:${name}`;
}
