/**
 * Splits a persisted user prompt text into its `<attached_file>` markers and the
 * user-typed message.
 *
 * The composer serializes mention/upload attachments as
 * `<attached_file path="...">content</attached_file>` blocks alongside the
 * user's typed text (see `formatAttachedFileSection`), and agent actions inline
 * a composed prompt the same way. The `general` master prompt is injected as a
 * `<user_preferences>` block. The renderer round-trips the same shape from the
 * persisted event stream. `<attached_file>` blocks are surfaced as chips wherever
 * they appear; the `<user_preferences>` block is stripped from the visible
 * message entirely (the agent still receives it in the raw prompt).
 */

import type {
	ParsedPrompt,
	ParsedPromptAttachment,
} from '@/renderer/types/pi-timeline';
import {
	attachedFileBlockPattern,
	leadingReferencedFoldersPattern,
	userPreferencesBlockPattern,
} from '@/shared/prompt-scaffolding';

/**
 * Splits a persisted prompt into its attachment blocks (referenced workspace
 * folders and `<attached_file>` markers, in order of appearance) and the
 * remaining typed text.
 * @param prompt - The raw persisted prompt text
 * @returns The extracted attachments and the remaining trimmed message text
 */
export function parsePromptAttachments(prompt: string): ParsedPrompt {
	let remaining = prompt;
	const attachments: ParsedPromptAttachment[] = [];

	const folderMatch = leadingReferencedFoldersPattern().exec(remaining);
	if (folderMatch) {
		const block = folderMatch[1] ?? '';
		const paths = block
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.startsWith('@'))
			.map((line) => line.slice(1));
		for (const path of paths) {
			attachments.push({ content: '', path });
		}
		remaining = remaining.slice(folderMatch[0].length);
	}

	remaining = remaining.replace(
		attachedFileBlockPattern(),
		(_match, rawPath: string, content: string) => {
			attachments.push({
				content: content ?? '',
				path: (rawPath ?? '').replaceAll('&quot;', '"'),
			});
			return '';
		},
	);

	// User preferences are context for the agent, not something to show back to
	// the user — strip the block from the visible message without a chip.
	remaining = remaining.replace(userPreferencesBlockPattern(), '');

	return { attachments, text: remaining.replace(/\n{3,}/g, '\n\n').trim() };
}

/** Convenience: just the chip-displayable path basename. */
export function chipLabelForPath(path: string): string {
	const trimmed = path.replace(/\/+$/, '');
	const idx = trimmed.lastIndexOf('/');
	return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}
