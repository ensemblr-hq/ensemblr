import { readWorkspaceFile } from '@/renderer/api/ensemblr-queries';
import { attachmentMark } from '@/renderer/lib/attachment-mark';
import { isReferenceAttachment } from '@/renderer/lib/workbench/composer-attachments';
import type {
	ComposerAttachment,
	ComposerDraftSegment,
	LinkedDirectory,
} from '@/renderer/types/workbench';
import { formatConciergeReferenceBlock } from '@/shared/concierge-references';
import {
	formatAttachedFileBlock,
	LINKED_DIRECTORIES_HEADER,
	REFERENCED_FOLDERS_HEADER,
} from '@/shared/prompt-scaffolding';

/**
 * Upper bound on inlined attachment content sent to the agent. Long `.context`
 * transcripts otherwise dominate the prompt and the agent tends to parrot the
 * content verbatim in its reply. Caller-side truncation keeps the prompt
 * focused while leaving a visible marker so the model knows context was
 * elided.
 */
const ATTACHED_FILE_MAX_CHARS = 8_000;
const ATTACHED_FILE_HEAD_CHARS = 2_500;
const ATTACHED_FILE_TAIL_CHARS = 5_000;
/**
 * Extensions whose content is inlined verbatim in the prompt. Everything else
 * (images, pdf, office docs, archives, unknown binaries) is announced by path
 * with a placeholder so the agent inspects the saved file directly instead of the
 * prompt being flooded with — or corrupted by — binary bytes.
 */
const TEXT_INLINE_EXTENSIONS = new Set([
	'c',
	'cfg',
	'conf',
	'cjs',
	'cpp',
	'cs',
	'css',
	'csv',
	'go',
	'h',
	'htm',
	'html',
	'ini',
	'java',
	'js',
	'json',
	'jsonc',
	'jsx',
	'kt',
	'log',
	'lua',
	'md',
	'markdown',
	'mjs',
	'php',
	'py',
	'rb',
	'rs',
	'scss',
	'sh',
	'sql',
	'svg',
	'swift',
	'toml',
	'ts',
	'tsx',
	'tsv',
	'txt',
	'xml',
	'yaml',
	'yml',
]);
const ATTACHMENT_PLACEHOLDER =
	'[attachment saved in the workspace — inspect this file directly if needed]';
const EXTERNAL_PLACEHOLDER = '[external file — inspect this path directly]';

/**
 * Wraps one attachment's content in the shared marker, truncated to budget and
 * carrying what the chip showed.
 *
 * The descriptor is what lets the sent message render the chip the user
 * arranged rather than the file it happened to be written to: a transcript, an
 * issue, a patch, and a review comment are all `.context/` documents named by a
 * generated id, so the path alone reads back as an anonymous `.md`.
 * @param attachment - The attachment being serialized.
 * @param content - The inlined body, before truncation.
 * @returns The `<attached_file>` block.
 */
function formatAttachedFileSection(
	attachment: ComposerAttachment,
	content: string,
): string {
	const mark = attachmentMark(attachment);
	return formatAttachedFileBlock(
		attachmentPromptPath(attachment),
		truncateAttachmentContent(content),
		{
			...(mark ? { label: attachment.label, mark } : {}),
		},
	);
}

/**
 * Keeps the opening for topic anchoring and the tail for the latest state,
 * replacing the middle with a `[...elided N chars...]` marker. Mirrors the
 * head/tail strategy the session-summary writer already uses for transcript
 * elision so the renderer and main process behave consistently.
 */
function truncateAttachmentContent(content: string): string {
	if (content.length <= ATTACHED_FILE_MAX_CHARS) {
		return content;
	}
	const head = content.slice(0, ATTACHED_FILE_HEAD_CHARS);
	const tail = content.slice(content.length - ATTACHED_FILE_TAIL_CHARS);
	const elided = content.length - head.length - tail.length;
	// Pinned to en-US, not the UI language: this text goes into an agent prompt,
	// so localizing it would make what the model sees vary by UI language.
	return `${head}\n\n[...elided ${elided.toLocaleString('en-US')} chars...]\n\n${tail}`;
}

/**
 * Announces the chat's linked directories by absolute path, so the agent knows
 * which roots outside the workspace it may work in.
 *
 * Sent with every message rather than once per session: the runtime grants
 * access at session open, but nothing keeps an earlier turn's announcement in
 * the model's working context, and a path per line is a negligible share of the
 * prompt.
 * @param directories - The chat's linked directories.
 * @returns The header block, or an empty string when nothing is linked.
 */
export function serializeLinkedDirectories(
	directories: readonly LinkedDirectory[],
): string {
	if (directories.length === 0) {
		return '';
	}
	return `${LINKED_DIRECTORIES_HEADER}\n${directories
		.map((directory) => directory.path)
		.join('\n')}`;
}

/**
 * Formats the composer draft into the text payload sent to the agent, keeping
 * the order the user arranged it in: each typed run and each attachment block
 * lands where its chip sat in the sentence, rather than every attachment being
 * hoisted to one end of the message.
 *
 * Text files are read over IPC and inlined in an `<attached_file>` block; images,
 * binaries, and externally referenced paths get a placeholder so the agent sees
 * the path without the prompt being flooded with bytes. Adjacent directory chips
 * collect into one referenced-folders header — they carry no inline content, so a
 * header apiece would be noise.
 *
 * Throws when a file read fails, so the caller can surface the error to the
 * user before clearing the composer.
 * @param segments - The draft's text runs and chips, in document order.
 * @param workspaceCwd - Absolute workspace root the relative paths resolve against.
 * @returns The serialized prompt body, or an empty string when the draft is blank.
 */
export async function serializeComposerDraft({
	segments,
	workspaceCwd,
}: {
	segments: readonly ComposerDraftSegment[];
	workspaceCwd: string;
}): Promise<string> {
	// Reads are independent, so issue them together before walking the draft;
	// each result keys back to its attachment so the emitted blocks stay in the
	// order the user put them in.
	const contentByAttachment = await readAttachmentContents(
		draftAttachments(segments),
		workspaceCwd,
	);

	const blocks: string[] = [];
	const pendingFolders: string[] = [];
	for (const segment of segments) {
		const folder = referencedFolderPath(segment);
		if (folder) {
			pendingFolders.push(folder);
			continue;
		}
		const block = segmentBlock(segment, contentByAttachment);
		if (!block) {
			continue;
		}
		if (pendingFolders.length > 0) {
			blocks.push(referencedFoldersBlock(pendingFolders));
			pendingFolders.splice(0);
		}
		blocks.push(block);
	}
	if (pendingFolders.length > 0) {
		blocks.push(referencedFoldersBlock(pendingFolders));
	}

	return blocks.join('\n\n');
}

/**
 * Every chip the draft carries, in document order.
 * @param segments - The draft's text runs and chips.
 * @returns The attachments behind the chips.
 */
function draftAttachments(
	segments: readonly ComposerDraftSegment[],
): readonly ComposerAttachment[] {
	return segments.flatMap((segment) =>
		segment.kind === 'attachment' ? [segment.attachment] : [],
	);
}

/**
 * The workspace folder a segment references, when it is a directory chip.
 * @param segment - The draft segment being walked.
 * @returns The repo-relative folder path, or null for anything else.
 */
function referencedFolderPath(segment: ComposerDraftSegment): string | null {
	return segment.kind === 'attachment' &&
		segment.attachment.kind === 'workspace-directory'
		? segment.attachment.path
		: null;
}

/**
 * Announces a run of directory chips under one header, since a folder carries no
 * inline content for the agent to read.
 * @param paths - Repo-relative folder paths, in the order their chips appear.
 * @returns The referenced-folders block.
 */
function referencedFoldersBlock(paths: readonly string[]): string {
	return `${REFERENCED_FOLDERS_HEADER}\n${paths.map((path) => `@${path}`).join('\n')}`;
}

/**
 * The prompt block one segment contributes: the trimmed typed run, or the
 * attachment's `<attached_file>` marker.
 * @param segment - The draft segment being walked.
 * @param contentByAttachment - Inlined bodies resolved for this draft.
 * @returns The block, or null when the segment carries nothing to send.
 */
function segmentBlock(
	segment: ComposerDraftSegment,
	contentByAttachment: ReadonlyMap<string, string>,
): string | null {
	if (segment.kind === 'text') {
		return segment.text.trim() || null;
	}
	if (isReferenceAttachment(segment.attachment)) {
		return formatConciergeReferenceBlock(segment.attachment.reference);
	}
	return formatAttachedFileSection(
		segment.attachment,
		contentByAttachment.get(segment.attachment.id) ?? ATTACHMENT_PLACEHOLDER,
	);
}

/**
 * Resolves the body of every attachment whose content is inlined, leaving the
 * rest to fall back to a placeholder.
 * @param attachments - The composer's attachments.
 * @param workspaceCwd - Absolute workspace root the relative paths resolve against.
 * @returns Attachment id to inlined body, for those that have one.
 */
async function readAttachmentContents(
	attachments: readonly ComposerAttachment[],
	workspaceCwd: string,
): Promise<Map<string, string>> {
	const resolved = await Promise.all(
		attachments.map((attachment) =>
			readAttachmentContent(attachment, workspaceCwd),
		),
	);
	const contentById = new Map<string, string>();
	for (const [index, content] of resolved.entries()) {
		const attachment = attachments[index];
		if (attachment && content !== null) {
			contentById.set(attachment.id, content);
		}
	}
	return contentById;
}

/**
 * Reads one attachment's inlined body, or null when it is announced by path
 * instead (a directory, an image, a binary, or a file outside the workspace).
 * @param attachment - The attachment to resolve.
 * @param workspaceCwd - Absolute workspace root the relative paths resolve against.
 * @returns The body to inline, or null to fall back to a placeholder.
 */
async function readAttachmentContent(
	attachment: ComposerAttachment,
	workspaceCwd: string,
): Promise<string | null> {
	if (attachment.kind === 'external-file') {
		return EXTERNAL_PLACEHOLDER;
	}
	if (isReferenceAttachment(attachment)) {
		return null;
	}
	if (
		attachment.kind === 'workspace-directory' ||
		!shouldInlineAsText(attachment.path)
	) {
		return null;
	}
	const result = await readWorkspaceFile({
		path: attachment.path,
		workspaceCwd,
	});
	if (result.error) {
		throw new Error(
			`Could not attach ${attachment.path}: ${result.error.message}`,
		);
	}
	if (result.contentEncoding === 'binary') {
		return null;
	}
	return result.content ?? '';
}

/**
 * The path an attachment is announced under inside its `<attached_file>` marker.
 * @param attachment - The attachment being serialized.
 * @returns The workspace-relative path, the absolute path, or the upload's name.
 */
function attachmentPromptPath(attachment: ComposerAttachment): string {
	if (attachment.kind === 'external-file') {
		return attachment.absolutePath;
	}
	return isReferenceAttachment(attachment) ? attachment.label : attachment.path;
}

/** Returns true when a file's content should be inlined as text rather than referenced by path. */
function shouldInlineAsText(pathValue: string): boolean {
	const extension = pathValue.split('.').pop()?.toLowerCase();
	return extension ? TEXT_INLINE_EXTENSIONS.has(extension) : false;
}
