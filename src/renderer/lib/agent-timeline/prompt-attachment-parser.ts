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

import { parseAttachmentMark } from '@/renderer/lib/attachment-mark';
import type {
	ParsedPrompt,
	ParsedPromptAttachment,
	ParsedPromptPart,
} from '@/renderer/types/agent-timeline';
import {
	conciergeReferenceBlockPattern,
	parseConciergeReferenceBlock,
} from '@/shared/concierge-references';
import {
	attachedFileBlockPattern,
	linkedDirectoriesBlockPattern,
	parseAttachedFileAttributes,
	referencedFoldersBlockPattern,
	userPreferencesBlockPattern,
} from '@/shared/prompt-scaffolding';

/** One scaffolding block located in the prompt, with the span it occupies. */
interface ScaffoldingBlock {
	end: number;
	/** What the block renders as, which is nothing for the dropped ones. */
	parts: readonly ParsedPromptPart[];
	start: number;
}

/** Wraps a parsed file attachment as the part that renders it. */
function attachmentPart(attachment: ParsedPromptAttachment): ParsedPromptPart {
	return { attachment, kind: 'attachment' };
}

/**
 * Locates every `<attached_file>` block, each one an attachment of its own.
 * @param prompt - The raw persisted prompt text
 * @returns The blocks found, in order of appearance
 */
function attachedFileBlocks(prompt: string): ScaffoldingBlock[] {
	return [...prompt.matchAll(attachedFileBlockPattern())].map((match) => {
		const { label, mark, path } = parseAttachedFileAttributes(
			match[1] ?? '',
			match[2] ?? '',
		);
		const parsedMark = parseAttachmentMark(mark);
		return {
			end: match.index + match[0].length,
			parts: [
				attachmentPart({
					content: match[3] ?? '',
					...(label ? { label } : {}),
					...(parsedMark ? { mark: parsedMark } : {}),
					path,
				}),
			],
			start: match.index,
		};
	});
}

/**
 * Locates every Concierge reference block, each one a project, workspace, or
 * chat the user pointed the Concierge at. A block missing the ids its chip would
 * need is skipped rather than rendered, so a truncated prompt reads back as
 * prose.
 * @param prompt - The raw persisted prompt text
 * @returns The blocks found, in order of appearance
 */
function conciergeReferenceBlocks(prompt: string): ScaffoldingBlock[] {
	return [...prompt.matchAll(conciergeReferenceBlockPattern())].flatMap(
		(match) => {
			const reference = parseConciergeReferenceBlock(
				match[1] ?? '',
				match[2] ?? '',
			);
			return reference
				? [
						{
							end: match.index + match[0].length,
							parts: [{ kind: 'reference' as const, reference }],
							start: match.index,
						},
					]
				: [];
		},
	);
}

/**
 * Locates every referenced-folders block, whose `@folder` lines each become a
 * contentless attachment so the message shows one chip per folder.
 * @param prompt - The raw persisted prompt text
 * @returns The blocks found, in order of appearance
 */
function referencedFolderBlocks(prompt: string): ScaffoldingBlock[] {
	return [...prompt.matchAll(referencedFoldersBlockPattern())].map((match) => ({
		end: match.index + match[0].length,
		parts: (match[1] ?? '')
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.startsWith('@'))
			.map((line) => attachmentPart({ content: '', path: line.slice(1) })),
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
		end: match.index + match[0].length,
		parts: [],
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
 * Splits a persisted prompt into the typed runs, the attachment blocks
 * (referenced workspace folders and `<attached_file>` markers), and the
 * Concierge reference blocks, in the order they appear — which is the order the
 * composer laid them out.
 * @param prompt - The raw persisted prompt text
 * @returns The prompt's parts, ready to render
 */
export function parsePromptAttachments(prompt: string): ParsedPrompt {
	const blocks = [
		...attachedFileBlocks(prompt),
		...conciergeReferenceBlocks(prompt),
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
		parts.push(...block.parts);
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
