import type { AttachmentMark } from '@/renderer/types/components';
import type { ComposerAttachment } from '@/renderer/types/workbench';

/**
 * Every mark a chip can wear, which is what narrows one read back out of a
 * prompt.
 *
 * Keyed rather than listed, and `satisfies` rather than annotated, so a mark
 * added to {@link AttachmentMark} and forgotten here is a compile error. A list
 * typed `readonly AttachmentMark[]` accepts a short one, and the cost of that is
 * the exact bug this module exists to prevent: the composer would wear the new
 * glyph while the sent bubble, refused by the parser, fell back to a file icon.
 */
const ATTACHMENT_MARKS = {
	'chat-transcript': true,
	'file-diff': true,
	'issue-github': true,
	'issue-linear': true,
	'review-comment-github': true,
	'review-comment-github-actions': true,
	'review-comment-linear': true,
	'review-comment-local': true,
	'review-comment-netlify': true,
	'review-comment-unknown': true,
	'review-comment-vercel': true,
	'subagent-chat': true,
	'subagent-transcript': true,
} satisfies Record<AttachmentMark, true>;

/**
 * The glyph token an attachment carries into the prompt, or null when its path
 * already names it — a workspace file, a directory, a paste, an external upload.
 * A reference chip has no `<attached_file>` block of its own, so it has no mark
 * here either.
 * @param attachment - The attachment being serialized.
 * @returns The mark, or null when the chip needs none.
 */
export function attachmentMark(
	attachment: ComposerAttachment,
): AttachmentMark | null {
	if (attachment.kind === 'chat-transcript') {
		return attachment.isSubAgent ? 'subagent-transcript' : 'chat-transcript';
	}
	if (attachment.kind === 'issue') {
		return `issue-${attachment.provider}`;
	}
	if (attachment.kind === 'review-comment') {
		return `review-comment-${attachment.comment.provider}`;
	}
	return attachment.kind === 'file-diff' ? 'file-diff' : null;
}

/** Narrows a raw string to a mark this build knows how to draw. */
function isAttachmentMark(value: unknown): value is AttachmentMark {
	return typeof value === 'string' && Object.hasOwn(ATTACHMENT_MARKS, value);
}

/**
 * Narrows a mark read back out of a persisted prompt, refusing one this build
 * does not know — a prompt sent by a later version should degrade to a plain
 * file chip rather than render nothing.
 * @param value - The raw `mark` attribute, absent on a block that carried none.
 * @returns The mark, or null when there is nothing usable.
 */
export function parseAttachmentMark(
	value: string | undefined,
): AttachmentMark | null {
	return isAttachmentMark(value) ? value : null;
}
