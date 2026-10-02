/**
 * Countermands Claude Code's own "prefer Bash for file work" instruction.
 *
 * Once a session runs without permission prompts, the CLI's system prompt tells
 * the model to read files with `cat`/`head`/`sed -n` and change them with `sed`,
 * heredocs, or a short script "rather than using the dedicated Read, Edit, or
 * Write tools". That is a sound trade in a terminal, where a prompt costs a
 * round trip and nothing renders the call. It is the wrong trade inside
 * Ensemblr: the conversation timeline projects an `Edit` or `Write` call as a
 * file row carrying the diff the user opens and comments on, while a file
 * rewritten inside a shell command renders as a command line with no path, no
 * diff, and nothing to anchor a review comment to.
 *
 * What this flips is the *preference*, not the toolbox. A shell is still the
 * honest answer for a build, a search, or a sweep the file tools would spend a
 * dozen calls on; the block says so, because a prohibition the model can see is
 * wrong in front of it is one it learns to read past.
 *
 * The instruction ships inside the `claude_code` preset and no SDK option turns
 * it off, so the only seam is the append the app already owns.
 */
import type { PermissionMode as SdkPermissionMode } from '@anthropic-ai/claude-agent-sdk';

/**
 * The SDK permission modes that stop charging for a permission prompt, which is
 * the condition the CLI's Bash-first instruction is written for. `acceptEdits`
 * is absent on purpose: it frees the file tools and still prompts for `Bash`, so
 * it pushes the model the way this app wants anyway.
 */
const UNPROMPTED_MODES: ReadonlySet<SdkPermissionMode> = new Set([
	'auto',
	'bypassPermissions',
	'dontAsk',
]);

/** The override block appended to the system prompt of an unprompted session. */
const EDIT_TOOL_DIRECTIVE = `Ensemblr reverses the preference stated elsewhere in this prompt: reach for the dedicated file tools before the Bash tool. Read to read a file, Edit and Write to change one.

The reason is the surface, not the shell. Ensemblr renders every tool call as a row in the user's conversation timeline, and an Edit or Write row carries the file path and the diff the user opens, reviews, and leaves comments on. A file changed inside a shell command renders as the command line alone, so the change it made never reaches the person reviewing the turn.

Bash remains the right tool wherever it genuinely is — running builds, tests, linters, git, and package managers; searching with \`grep\`, \`rg\`, or \`find\`; inspecting something no file tool reads; and the occasional mechanical sweep that would take a dozen edits to express. Prefer it on its own merits rather than to save a permission prompt, and when you do change files that way, say in your reply what changed so the turn stays reviewable.`;

/**
 * Resolves the `append` a session's system prompt opens with, adding the
 * file-tool override when the permission mode is one the CLI steers toward Bash.
 * @param input - The session's resolved SDK permission mode and the app's own append, when it has one.
 * @returns The append to hand the SDK, or null when there is nothing to append.
 */
export function resolveSystemPromptAppend({
	permissionMode,
	systemPromptAppend,
}: {
	permissionMode: SdkPermissionMode;
	systemPromptAppend?: string | null;
}): string | null {
	const blocks = [
		systemPromptAppend?.trim() ? systemPromptAppend : null,
		UNPROMPTED_MODES.has(permissionMode) ? EDIT_TOOL_DIRECTIVE : null,
	].filter((block) => block !== null);
	return blocks.length > 0 ? blocks.join('\n\n') : null;
}
