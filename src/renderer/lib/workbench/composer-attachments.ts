import {
	getPathForFile,
	writeWorkspaceFileAttachment,
	writeWorkspaceImageAttachment,
} from '@/renderer/api/ensemblr-queries';
import { i18n } from '@/renderer/lib/i18n';
import { terminalSelectionFilename } from '@/renderer/lib/workbench/attachment-filename';
import {
	commentAnchorLabel,
	commentDocumentFilename,
	renderCommentDocument,
} from '@/renderer/lib/workbench/comment-document';
import {
	diffDocumentFilename,
	renderDiffDocument,
} from '@/renderer/lib/workbench/diff-document';
import { issueDocumentFilename } from '@/renderer/lib/workbench/issue-document';
import type {
	ComposerAttachment,
	ComposerTextSource,
	PullRequestCommentSummary,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';
import type { WorkspaceFileEntryWire } from '@/shared/ipc/contracts/workspace-files';

/** MIME prefix shared by clipboard files that should become image attachments. */
const IMAGE_MIME_PREFIX = 'image/';

/**
 * Image MIME types the main process cannot persist as raster images (it has no
 * magic-byte signature for them), so they are routed to the file-attachment
 * path and inlined as text instead of being rejected. SVG is XML text.
 */
const NON_RASTER_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/svg+xml']);

/**
 * Files at or under this size are copied into the workspace; larger files are
 * referenced by absolute path (falling back to a copy when the paste has no
 * resolvable path). Mirrors the main-process image cap.
 */
const SMALL_FILE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * How much of a pasted block the chip keeps for its preview. Long enough to
 * fill the card's two-line clamp at any sensible width, short enough that the
 * serialized draft does not carry the whole paste twice.
 */
const PASTED_TEXT_PREVIEW_CHARS = 240;

/** Filename every pasted-text attachment is persisted under. */
const PASTED_TEXT_FILENAME = 'pasted-text.txt';

/**
 * Outcome of persisting a batch of pasted/dropped files: every file that landed
 * becomes an attachment, and the first failure (if any) surfaces as a
 * user-facing message.
 */
export interface AttachPastedFilesResult {
	attachments: ComposerAttachment[];
	error: string | null;
}

/**
 * Builds the attachment for a workspace file or directory the user referenced.
 * Takes only the fields the chip is built from, so a caller holding a path and a
 * kind — the file tree's right-click menu — does not have to invent a row id.
 * @param entry - The file-tree row the mention or chip resolved to.
 * @returns The composer attachment for that entry.
 */
export function workspaceFileAttachment(
	entry: Omit<WorkspaceFileSummary, 'id'>,
): ComposerAttachment {
	if (entry.kind === 'directory') {
		return {
			id: `wsdir:${entry.path}`,
			kind: 'workspace-directory',
			label: entry.name,
			path: entry.path,
		};
	}
	return {
		id: `wsfile:${entry.path}`,
		isIgnored: entry.isIgnored,
		kind: 'workspace-file',
		label: entry.name,
		path: entry.path,
	};
}

/**
 * Builds the attachment for a block of stored text, carrying the preview and
 * line count its chip renders.
 * @param path - Workspace-relative path the text was persisted to.
 * @param text - The full text.
 * @param source - Where the block came from; omitted for a clipboard paste.
 * @returns The composer attachment for that block.
 */
function pastedTextAttachment(
	path: string,
	text: string,
	source?: ComposerTextSource,
): ComposerAttachment {
	return {
		id: `wsfile:${path}`,
		kind: 'pasted-text',
		label: path.split('/').at(-1) ?? path,
		lineCount: text.split('\n').length,
		path,
		preview: text.replace(/^\s*\n+/, '').slice(0, PASTED_TEXT_PREVIEW_CHARS),
		...(source ? { source } : {}),
	};
}

/**
 * The workspace-relative path a chip can open in the file preview, or null when
 * the file preview is not where the chip should go. A directory has no file to
 * read, an oversize external file was left outside the workspace (which the main
 * process refuses to read), and a review comment opens its own preview panel
 * rather than the markdown document it was written to.
 * @param attachment - The attachment behind the chip.
 * @returns The repo-relative path to preview, or null.
 */
export function attachmentPreviewPath(
	attachment: ComposerAttachment,
): string | null {
	switch (attachment.kind) {
		case 'chat-transcript':
		case 'file-diff':
		case 'issue':
		case 'pasted-text':
		case 'workspace-file':
			return attachment.path;
		default:
			return null;
	}
}

/**
 * Whether a chip stands for one of the app's own surfaces — a project, a
 * workspace, a chat, or a Concierge artifact — rather than for a file in a
 * workspace. Such a chip has no workspace path and no bytes to inline: it
 * serializes to a block of ids the agent addresses its own ops with, and it may
 * repeat within one draft, standing wherever the sentence names its surface.
 *
 * Tests for the payload rather than listing the kinds that carry it, so a fifth
 * reference kind is covered the day it is declared. A hand-listed kind missed
 * here reads as a file chip at every call site: deduped away on insert, and
 * serialized as an `<attached_file>` whose path is its label.
 * @param attachment - The attachment being walked.
 * @returns True when the attachment carries a reference.
 */
export function isReferenceAttachment(
	attachment: ComposerAttachment,
): attachment is Extract<ComposerAttachment, { reference: unknown }> {
	return 'reference' in attachment;
}

/** Extracts every file from a browser clipboard or drag payload. */
export function getTransferFiles(data: DataTransfer): readonly File[] {
	const files: File[] = [];
	for (const item of Array.from(data.items)) {
		if (item.kind !== 'file') {
			continue;
		}
		const file = item.getAsFile();
		if (file) {
			files.push(file);
		}
	}
	if (files.length > 0) {
		return files;
	}
	return Array.from(data.files);
}

/**
 * The message shown when a pasted file cannot be read off the clipboard.
 * @returns The message in the active language.
 */
function readFailureMessage(): string {
	return i18n.t(
		'errors:attachment.read-failed.message',
		'Pasted file could not be read.',
	);
}

/**
 * The message shown when a pasted file cannot be persisted into the workspace.
 * @returns The message in the active language.
 */
function saveFailureMessage(): string {
	return i18n.t(
		'errors:attachment.save-failed.message',
		'Pasted file could not be saved.',
	);
}

/** Reads a browser File as the base64 body of a data URL. */
function readFileAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener('load', () => {
			const result = reader.result;
			if (typeof result !== 'string') {
				reject(new Error(readFailureMessage()));
				return;
			}
			const separatorIndex = result.indexOf(',');
			if (separatorIndex === -1) {
				reject(
					new Error(
						i18n.t(
							'errors:attachment.malformed.message',
							'Pasted file payload was malformed.',
						),
					),
				);
				return;
			}
			resolve(result.slice(separatorIndex + 1));
		});
		reader.addEventListener('error', () => {
			reject(reader.error ?? new Error(readFailureMessage()));
		});
		reader.readAsDataURL(file);
	});
}

/** Returns the final path segment of an absolute path, for a chip label fallback. */
function basename(absolutePath: string): string {
	const segments = absolutePath.split(/[/\\]/);
	return segments.at(-1) || absolutePath;
}

/** Converts a persisted workspace file entry into the composer's chip shape. */
function toWorkspaceFileSummary(
	file: WorkspaceFileEntryWire,
): WorkspaceFileSummary {
	return {
		id: `wsfile:${file.path}`,
		isIgnored: file.isIgnored,
		kind: file.kind,
		name: file.name,
		path: file.path,
	};
}

/**
 * True when a file should be persisted through the raster-image write path: a
 * small image the main process can validate by magic bytes (SVG and other
 * non-raster image types fall through to the file path so they are inlined).
 */
function shouldWriteAsImage(file: File): boolean {
	return (
		file.size <= SMALL_FILE_MAX_BYTES &&
		file.type.startsWith(IMAGE_MIME_PREFIX) &&
		!NON_RASTER_IMAGE_TYPES.has(file.type)
	);
}

/** Original filename to persist, or undefined so the main process names it. */
function attachmentName(file: File): string | undefined {
	return file.name || undefined;
}

/**
 * Copies one file into the workspace, choosing the image or file write path.
 * @param file - The file to persist.
 * @param workspaceCwd - Absolute workspace root the copy belongs to.
 * @returns The stored file's row, carrying the path the store placed it at.
 */
async function saveCopy(
	file: File,
	workspaceCwd: string,
): Promise<WorkspaceFileEntryWire> {
	const contentBase64 = await readFileAsBase64(file);
	const result = shouldWriteAsImage(file)
		? await writeWorkspaceImageAttachment({
				contentBase64,
				mimeType: file.type || 'image/png',
				name: attachmentName(file),
				workspaceCwd,
			})
		: await writeWorkspaceFileAttachment({
				contentBase64,
				name: attachmentName(file),
				workspaceCwd,
			});
	if (result.error || !result.file) {
		throw new Error(result.error?.message ?? saveFailureMessage());
	}
	return result.file;
}

/**
 * Persists a long pasted block as a text attachment so a wall of pasted output
 * becomes a chip instead of burying the draft. Content-addressed, so pasting the
 * same block into several chats stores it once.
 * @param text - The pasted text.
 * @param workspaceCwd - Absolute workspace root the text is saved under.
 * @returns The attachment for the stored paste.
 */
export async function attachPastedText(
	text: string,
	workspaceCwd: string,
): Promise<ComposerAttachment> {
	const file = new File([text], PASTED_TEXT_FILENAME, { type: 'text/plain' });
	const saved = await saveCopy(file, workspaceCwd);
	return pastedTextAttachment(saved.path, text);
}

/**
 * Persists a selection taken from a terminal surface as a text attachment, so a
 * stack trace or a failing run reaches the agent as a chip rather than being
 * copied through the clipboard into the middle of the draft.
 *
 * Stored as a `.txt` named for the pane it came off, which is what both the
 * chip's stored file and the agent's `<attached_file path>` read — so a
 * selection announces which terminal produced it rather than arriving as
 * anonymous output.
 * @param label - What the terminal pane calls itself.
 * @param text - The selected terminal text.
 * @param workspaceCwd - Absolute workspace root the text is saved under.
 * @returns The attachment for the stored selection.
 */
export async function attachTerminalSelection({
	label,
	text,
	workspaceCwd,
}: {
	label: string;
	text: string;
	workspaceCwd: string;
}): Promise<ComposerAttachment> {
	const file = new File([text], await terminalSelectionFilename(label), {
		type: 'text/plain',
	});
	const saved = await saveCopy(file, workspaceCwd);
	return pastedTextAttachment(saved.path, text, {
		kind: 'terminal',
		label: label.trim(),
	});
}

/**
 * Writes a rendered issue document into the workspace and returns the chip for
 * it. The whole issue lands on disk, so the agent reads it as a file rather than
 * being handed a summary line and left to fetch the rest itself.
 * @param document - The rendered markdown body.
 * @param provider - Tracker the issue came from, which picks the chip's brand mark.
 * @param reference - Human issue reference, such as `ENG-106` or `#42`.
 * @param workspaceCwd - Absolute workspace root the document is saved under.
 * @returns The composer attachment for the stored issue.
 */
export async function attachIssueDocument({
	document,
	provider,
	reference,
	workspaceCwd,
}: {
	document: string;
	provider: 'github' | 'linear';
	reference: string;
	workspaceCwd: string;
}): Promise<ComposerAttachment> {
	const file = new File(
		[document],
		issueDocumentFilename(provider, reference),
		{
			type: 'text/markdown',
		},
	);
	const saved = await saveCopy(file, workspaceCwd);
	return {
		id: `issue:${provider}:${reference}`,
		kind: 'issue',
		label: reference,
		path: saved.path,
		provider,
	};
}

/**
 * Writes a file's unified patch into the workspace and returns the chip for it.
 * The patch lands on disk rather than being pasted into the draft, so a
 * thousand-line rewrite becomes one chip instead of burying the user's question
 * under its own diff — the send pipeline inlines the document at submit.
 *
 * The store is content-addressed, so the chip's id changes when the diff does:
 * re-attaching after the agent touches the file again lands a fresh chip rather
 * than being deduped against the stale one.
 * @param filePath - Workspace-relative path the patch was taken against.
 * @param patch - The unified patch text.
 * @param workspaceCwd - Absolute workspace root the document is saved under.
 * @returns The composer attachment for the stored diff.
 */
export async function attachFileDiff({
	filePath,
	patch,
	workspaceCwd,
}: {
	filePath: string;
	patch: string;
	workspaceCwd: string;
}): Promise<ComposerAttachment> {
	const file = new File(
		[renderDiffDocument({ filePath, patch })],
		diffDocumentFilename(filePath),
		{ type: 'text/markdown' },
	);
	const saved = await saveCopy(file, workspaceCwd);
	return {
		filePath,
		id: `file-diff:${saved.path}`,
		kind: 'file-diff',
		label: filePath.split('/').at(-1) ?? filePath,
		path: saved.path,
	};
}

/**
 * What a review-comment chip reads: the comment's diff anchor, falling back to
 * its author for a thread that hangs off the pull request rather than a line. A
 * local comment always carries a path, so the author branch only ever serves a
 * remote one — whose `author` really is a person, not the location.
 * @param comment - The comment behind the chip.
 * @returns The chip label; never empty.
 */
function reviewCommentLabel(comment: PullRequestCommentSummary): string {
	return (
		commentAnchorLabel(comment) ||
		comment.author?.trim() ||
		i18n.t('review:comment.attachment-label', 'Review comment')
	);
}

/**
 * Writes a rendered review comment into the workspace and returns the chip for
 * it. The whole thread lands on disk, so the agent reads it as a file instead of
 * the composer pasting an excerpt into the middle of the user's sentence.
 *
 * The comment rides along on the attachment so the chip can open its preview
 * without going back to GitHub or the database for a thread already in hand.
 * @param comment - The review comment being attached.
 * @param prNumber - The pull request the comment belongs to, when known.
 * @param workspaceCwd - Absolute workspace root the document is saved under.
 * @returns The composer attachment for the stored comment.
 */
export async function attachReviewComment({
	comment,
	prNumber,
	workspaceCwd,
}: {
	comment: PullRequestCommentSummary;
	prNumber?: number;
	workspaceCwd: string;
}): Promise<ComposerAttachment> {
	const file = new File(
		[renderCommentDocument(comment, prNumber)],
		commentDocumentFilename(comment),
		{ type: 'text/markdown' },
	);
	const saved = await saveCopy(file, workspaceCwd);
	return {
		comment: {
			...comment,
			...(typeof prNumber === 'number' ? { prNumber } : {}),
		},
		id: `review-comment:${comment.id}`,
		kind: 'review-comment',
		label: reviewCommentLabel(comment),
		path: saved.path,
	};
}

/**
 * Persists pasted/dropped files into the workspace's content-addressed
 * attachment store; files too large to copy are referenced by absolute path when
 * one is resolvable, otherwise copied as a fallback. Files saved before a failure
 * are still returned alongside the error so partial success is preserved.
 * @param files - The pasted or dropped files to persist.
 * @param workspaceCwd - Absolute workspace root the files belong to.
 * @returns The attachments that landed, plus the first failure message if any.
 */
export async function attachPastedFiles(
	files: readonly File[],
	workspaceCwd: string,
): Promise<AttachPastedFilesResult> {
	const attachments: ComposerAttachment[] = [];
	let error: string | null = null;
	try {
		for (const file of files) {
			if (file.size > SMALL_FILE_MAX_BYTES) {
				const absolutePath = getPathForFile(file);
				if (absolutePath) {
					attachments.push({
						absolutePath,
						id: `external:${absolutePath}`,
						kind: 'external-file',
						label: file.name || basename(absolutePath),
						sizeBytes: file.size,
					});
					continue;
				}
			}
			const saved = await saveCopy(file, workspaceCwd);
			attachments.push(workspaceFileAttachment(toWorkspaceFileSummary(saved)));
		}
	} catch (cause) {
		error = cause instanceof Error ? cause.message : saveFailureMessage();
	}
	return { attachments, error };
}
