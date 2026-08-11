import { readWorkspaceFile } from '@/renderer/api/ensemblr-queries';
import type {
	ComposerAttachment,
	LinkedDirectory,
} from '@/renderer/types/workbench';
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

/** Wraps one workspace file's content in the shared attachment marker, truncated to budget. */
function formatAttachedFileSection(pathValue: string, content: string): string {
	return formatAttachedFileBlock(pathValue, truncateAttachmentContent(content));
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
 * Formats the composer's ordered attachment list into the text payload appended
 * to the user's prompt when sent to the agent.
 *
 * Directories collect into one leading header so the agent knows the user
 * referenced them without expecting inline content. Text files are read over IPC
 * and inlined in an `<attached_file>` block; images, binaries, and externally
 * referenced paths get a placeholder so the agent sees the path without the
 * prompt being flooded with bytes.
 *
 * Throws when a file read fails, so the caller can surface the error to the
 * user before clearing the composer.
 * @param attachments - The composer's attachments, in the order the user added them.
 * @param workspaceCwd - Absolute workspace root the relative paths resolve against.
 * @returns The block of attachment sections, or an empty string when there are none.
 */
export async function serializeComposerAttachments({
	attachments,
	workspaceCwd,
}: {
	attachments: readonly ComposerAttachment[];
	workspaceCwd: string;
}): Promise<string> {
	if (attachments.length === 0) {
		return '';
	}

	const sections: string[] = [];
	const directories = attachments.filter(
		(entry) => entry.kind === 'workspace-directory',
	);
	if (directories.length > 0) {
		sections.push(
			`${REFERENCED_FOLDERS_HEADER}\n${directories.map((entry) => `@${entry.path}`).join('\n')}`,
		);
	}

	// Reads are independent, so issue them together before walking the list;
	// each result keys back to its attachment so the emitted sections stay in the
	// user's original order.
	const contentByAttachment = await readAttachmentContents(
		attachments,
		workspaceCwd,
	);
	for (const attachment of attachments) {
		if (attachment.kind === 'workspace-directory') {
			continue;
		}
		sections.push(
			formatAttachedFileSection(
				attachmentPromptPath(attachment),
				contentByAttachment.get(attachment.id) ?? ATTACHMENT_PLACEHOLDER,
			),
		);
	}

	return sections.join('\n\n');
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
	return result.content ?? '';
}

/**
 * The path an attachment is announced under inside its `<attached_file>` marker.
 * @param attachment - The attachment being serialized.
 * @returns The workspace-relative path, the absolute path, or the upload's name.
 */
function attachmentPromptPath(attachment: ComposerAttachment): string {
	return attachment.kind === 'external-file'
		? attachment.absolutePath
		: attachment.path;
}

/** Returns true when a file's content should be inlined as text rather than referenced by path. */
function shouldInlineAsText(pathValue: string): boolean {
	const extension = pathValue.split('.').pop()?.toLowerCase();
	return extension ? TEXT_INLINE_EXTENSIONS.has(extension) : false;
}
