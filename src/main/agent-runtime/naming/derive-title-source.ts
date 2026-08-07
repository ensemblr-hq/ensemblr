/**
 * Pure helper for reducing a persisted/composed user prompt down to the typed
 * message text, so a deterministic tab title is drawn from what the user wrote
 * rather than the surrounding scaffolding. Kept free of the pi/sqlite runtime so
 * it unit-tests under Vitest alongside `sanitize-title.ts`.
 */

import { parseSlashCommand } from '../../../shared/pi-skill-invocation.ts';
import {
	attachedFileBlockPattern,
	referencedFoldersBlockPattern,
	userPreferencesBlockPattern,
} from '../../../shared/prompt-scaffolding.ts';

/**
 * Strips the composer/master-prompt scaffolding from a prompt, leaving the
 * user's typed text. Removes every referenced-folders preamble (wherever it
 * appears, not just at the start), all `<user_preferences>` blocks, and all
 * `<attached_file>` blocks, then collapses blank runs and trims. Uses the shared
 * scaffolding patterns so a renderer wording change cannot leak into the title.
 * @param prompt - The raw persisted or composed prompt text.
 * @returns The residual typed message text, which may be empty.
 */
export function stripPromptScaffolding(prompt: string): string {
	return prompt
		.replace(referencedFoldersBlockPattern(), '')
		.replace(userPreferencesBlockPattern(), '')
		.replace(attachedFileBlockPattern(), '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Reduces a prompt to the text a tab title should describe: the composer
 * scaffolding is stripped first, then a leading slash command is dropped in
 * favor of its arguments, since `/skill:caveman` names the tool and
 * `write a haiku` names the work. Stripping has to run first because the master
 * prompt wraps the typed text, so the slash is not leading until it is gone.
 * @param prompt - The raw persisted or composed prompt text.
 * @returns The residual text describing the work, which is empty only when the prompt was pure scaffolding.
 */
export function deriveTitleSource(prompt: string): string {
	const typed = stripPromptScaffolding(prompt);
	const command = parseSlashCommand(typed);
	if (!command) {
		return typed;
	}
	return command.args || humanizeCommandName(command.name);
}

/**
 * Renders a bare command name as prose, so a tab whose prompt carried no
 * arguments still gets a readable title instead of a blank one.
 * @param name - The command name without its leading slash, e.g. `skill:code-review`.
 * @returns The name with its skill prefix and separators removed, sentence-cased.
 */
function humanizeCommandName(name: string): string {
	const words = name
		.replace(/^skill:/, '')
		.replace(/[-_:]+/g, ' ')
		.trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}
