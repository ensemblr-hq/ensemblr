/**
 * Splits a persisted user prompt text into its `<attached_file>` markers and the
 * user-typed message.
 *
 * The composer serializes mention/upload attachments as
 * `<attached_file path="...">content</attached_file>` blocks interleaved with the
 * user's typed text, at the position the chip sat in the sentence (see
 * `serializeComposerDraft`), and agent actions inline a composed prompt the same
 * way. The `general` master prompt is injected as a `<user_preferences>` block.
 * The renderer round-trips the same shape from the persisted event stream, so the
 * message reads back in the order it was sent; the `<user_preferences>` block is
 * dropped from the visible message entirely (the agent still receives it in the
 * raw prompt).
 */

import type {
	ParsedPrompt,
	ParsedPromptAttachment,
	ParsedPromptPart,
} from '@/renderer/types/agent-timeline';
import {
	attachedFileBlockPattern,
	linkedDirectoriesBlockPattern,
	referencedFoldersBlockPattern,
	userPreferencesBlockPattern,
} from '@/shared/prompt-scaffolding';

/** One scaffolding block located in the prompt, with the span it occupies. */
interface ScaffoldingBlock {
	attachments: readonly ParsedPromptAttachment[];
	end: number;
	start: number;
}

/**
 * Locates every `<attached_file>` block, each one an attachment of its own.
 * @param prompt - The raw persisted prompt text
 * @returns The blocks found, in order of appearance
 */
function attachedFileBlocks(prompt: string): ScaffoldingBlock[] {
	return [...prompt.matchAll(attachedFileBlockPattern())].map((match) => ({
		attachments: [
			{
				content: match[2] ?? '',
				path: (match[1] ?? '').replaceAll('&quot;', '"'),
			},
		],
		end: match.index + match[0].length,
		start: match.index,
	}));
}

/**
 * Locates every referenced-folders block, whose `@folder` lines each become a
 * contentless attachment so the message shows one chip per folder.
 * @param prompt - The raw persisted prompt text
 * @returns The blocks found, in order of appearance
 */
function referencedFolderBlocks(prompt: string): ScaffoldingBlock[] {
	return [...prompt.matchAll(referencedFoldersBlockPattern())].map((match) => ({
		attachments: (match[1] ?? '')
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.startsWith('@'))
			.map((line) => ({ content: '', path: line.slice(1) })),
		end: match.index + match[0].length,
		start: match.index,
	}));
}

/**
 * Locates the blocks that are stripped without leaving a chip: the linked
 * directories, which are a standing grant the composer re-sends with every
 * message rather than an attachment on this one, and the user preferences, which
 * are context for the agent and not something to show back to the user.
 * @param prompt - The raw persisted prompt text
 * @returns The blocks found, in order of appearance
 */
function droppedBlocks(prompt: string): ScaffoldingBlock[] {
	return [
		...prompt.matchAll(linkedDirectoriesBlockPattern()),
		...prompt.matchAll(userPreferencesBlockPattern()),
	].map((match) => ({
		attachments: [],
		end: match.index + match[0].length,
		start: match.index,
	}));
}

/**
 * Appends a run of typed text, dropping it when it is only the whitespace that
 * separated two blocks.
 * @param parts - The parts collected so far
 * @param text - The raw run between two blocks
 */
function pushText(parts: ParsedPromptPart[], text: string): void {
	const trimmed = text.replace(/\n{3,}/g, '\n\n').trim();
	if (trimmed.length > 0) {
		parts.push({ kind: 'text', text: trimmed });
	}
}

/**
 * Splits a persisted prompt into the typed runs and the attachment blocks
 * (referenced workspace folders and `<attached_file>` markers), in the order they
 * appear — which is the order the composer laid them out.
 * @param prompt - The raw persisted prompt text
 * @returns The prompt's parts, ready to render
 */
export function parsePromptAttachments(prompt: string): ParsedPrompt {
	const blocks = [
		...attachedFileBlocks(prompt),
		...referencedFolderBlocks(prompt),
		...droppedBlocks(prompt),
	].sort((left, right) => left.start - right.start);

	const parts: ParsedPromptPart[] = [];
	let cursor = 0;
	for (const block of blocks) {
		// A header inside an inlined file body matches too; the outer block already
		// consumed that span, so anything starting behind the cursor is not a block.
		if (block.start < cursor) {
			continue;
		}
		pushText(parts, prompt.slice(cursor, block.start));
		for (const attachment of block.attachments) {
			parts.push({ attachment, kind: 'attachment' });
		}
		cursor = block.end;
	}
	pushText(parts, prompt.slice(cursor));

	return { parts };
}

/** Convenience: just the chip-displayable path basename. */
export function chipLabelForPath(path: string): string {
	const trimmed = path.replace(/\/+$/, '');
	const idx = trimmed.lastIndexOf('/');
	return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}
