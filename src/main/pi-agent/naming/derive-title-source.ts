/**
 * Pure helper for reducing a persisted/composed user prompt down to the typed
 * message text, so a deterministic tab title is drawn from what the user wrote
 * rather than the surrounding scaffolding. Kept free of the pi/sqlite runtime so
 * it unit-tests under Vitest alongside `sanitize-title.ts`.
 */

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
