/**
 * Public runtime surface of `lib/pi` — the renderer helpers that exist only
 * because of how the Pi CLI shapes a conversation: the `data-pi-custom` and
 * `data-pi-skill` message parts its extensions inject, and the client-side
 * `/skill:` expansion it echoes back inside the user's prompt.
 *
 * Everything a second runtime would also need lives in
 * `@/renderer/lib/agent-timeline` instead. Importers outside this folder should
 * reach for `@/renderer/lib/pi` rather than the leaf modules.
 *
 * Per renderer convention this barrel re-exports runtime values only; shared
 * exported renderer types belong under `@/renderer/types/`.
 */

export {
	buildCustomMessagePart,
	customMessageDataOf,
} from './custom-message-part.ts';
export {
	parseSkillInvocation,
	skillCommandText,
	skillInvocationKey,
} from './skill-invocation.ts';
export { buildSkillPart, skillPartDataOf } from './skill-part.ts';
