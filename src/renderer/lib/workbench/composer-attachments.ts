import {
	getPathForFile,
	writeWorkspaceFileAttachment,
	writeWorkspaceImageAttachment,
} from '@/renderer/api/ensemblr-queries';
import {
	type CodedFailure,
	failureDetail,
	failureText,
} from '@/renderer/lib/failure-text';
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
	ComposerIssueAttachment,
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
 * The path a chip can open in the file preview, or null when the file preview is
 * not where the chip should go. A directory has no file to read, and a review
 * comment opens its own preview panel rather than the markdown document it was
 * written to. An oversize file left outside the workspace previews by its
 * absolute path, which the preview reads the same way it reads a file an agent
 * wrote outside the workspace — that is how a large GIF gets shown at all.
 * @param attachment - The attachment behind the chip.
 * @returns The repo-relative or absolute path to preview, or null.
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
		case 'external-file':
			return attachment.absolutePath;
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

/**
 * What a clipboard or drag payload carries: every entry in the order it arrived,
 * so the chips land in the order the user dropped them, with the folders among
 * them marked because a folder has no bytes to store.
 */
export interface TransferItems {
	entries: readonly File[];
	folders: ReadonlySet<File>;
}

/** The folder set of a payload known to carry none. */
const NO_FOLDERS: ReadonlySet<File> = new Set();

/**
 * Extracts every file and folder from a browser clipboard or drag payload. A
 * dropped folder arrives as a `File` too, but one whose bytes cannot be read, so
 * it is told apart by its entry rather than discovered by a failed read. A
 * payload with no items falls back to its bare file list, which carries no
 * entries to tell a folder by; a folder there fails its read and is reported as
 * a file that could not be read.
 * @param data - The clipboard or drag payload.
 * @returns The payload's entries in arrival order, with its folders marked.
 */
export function getTransferItems(data: DataTransfer): TransferItems {
	const entries: File[] = [];
	const folders = new Set<File>();
	for (const item of Array.from(data.items)) {
		const file = item.kind === 'file' ? item.getAsFile() : null;
		if (file) {
			entries.push(file);
			if (isFolderItem(item)) {
				folders.add(file);
			}
		}
	}
	if (entries.length > 0) {
		return { entries, folders };
	}
	return { entries: Array.from(data.files), folders: NO_FOLDERS };
}

/**
 * Whether a clipboard or drag payload carries anything to attach.
 * @param items - The payload's entries.
 * @returns True when it holds at least one file or folder.
 */
export function hasTransferItems({ entries }: TransferItems): boolean {
	return entries.length > 0;
}

/**
 * Wraps a plain file list, such as a file picker's, as a payload with no folders.
 * @param files - The picked files.
 * @returns The files as transfer items.
 */
export function transferItemsFromFiles(files: readonly File[]): TransferItems {
	return { entries: files, folders: NO_FOLDERS };
}

/**
 * Whether a transfer item is a folder rather than a file.
 * @param item - One entry of a clipboard or drag payload.
 * @returns True when the item's entry is a directory.
 */
function isFolderItem(item: DataTransferItem): boolean {
	return item.webkitGetAsEntry?.()?.isDirectory === true;
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

/**
 * The message shown when a dropped folder lives outside the workspace, where a
 * folder chip has nothing to point at.
 * @param name - The folder's name.
 * @returns The message in the active language.
 */
function folderOutsideWorkspaceMessage(name: string): string {
	return i18n.t(
		'errors:attachment.folder-outside-workspace.message',
		'{{name}} is a folder outside this workspace. Use Link directory to give the agent access to it.',
		{ name },
	);
}

/**
 * The message shown when the main process refused to store a file: the coded
 * headline in the active language, followed by main's own words only when they
 * carry runtime detail the headline cannot, such as the OS error behind a
 * failed write.
 * @param failure - The coded failure main reported.
 * @returns The message to show.
 */
function attachmentFailureMessage(failure: CodedFailure): string {
	const headline = failureText(i18n.t, failure) ?? saveFailureMessage();
	const detail = failureDetail(i18n.t, failure);
	return detail ? `${headline} ${detail}` : headline;
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
			reject(new Error(readFailureMessage()));
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
 * small, non-empty image the main process names after the format its bytes
 * carry. SVG is markup and falls through to the file path so it is inlined, and
 * an empty file does too, since the file path is the one that stores it.
 */
function shouldWriteAsImage(file: File): boolean {
	return (
		file.size > 0 &&
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
		throw new Error(
			result.error
				? attachmentFailureMessage(result.error)
				: saveFailureMessage(),
		);
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
}): Promise<ComposerIssueAttachment> {
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
 * Attaches pasted/dropped entries in the order they arrived, so the chips read
 * in the order the user dropped them. Files are stored in the workspace's
 * content-addressed attachment store, or referenced by absolute path when too
 * large to copy and one is resolvable; folders inside the workspace become
 * folder chips. The first file that fails stops the run so its error names the
 * file the user is looking at rather than the last of a cascade; everything
 * attached before it is still returned.
 * @param items - The pasted or dropped entries, with their folders marked.
 * @param workspaceCwd - Absolute workspace root the entries belong to.
 * @returns The attachments that landed, plus the first failure message if any.
 */
export async function attachPastedFiles(
	{ entries, folders }: TransferItems,
	workspaceCwd: string,
): Promise<AttachPastedFilesResult> {
	const attachments: ComposerAttachment[] = [];
	let folderError: string | null = null;
	try {
		for (const entry of entries) {
			if (!folders.has(entry)) {
				attachments.push(await attachFile(entry, workspaceCwd));
				continue;
			}
			const outcome = attachDroppedFolder(entry, workspaceCwd);
			if ('attachment' in outcome) {
				attachments.push(outcome.attachment);
			} else {
				folderError ??= outcome.error;
			}
		}
	} catch (cause) {
		const fileError =
			cause instanceof Error ? cause.message : saveFailureMessage();
		return { attachments, error: fileError };
	}
	return { attachments, error: folderError };
}

/**
 * Attaches one pasted or dropped file: referenced by absolute path when it is
 * too large to copy and has one, otherwise copied into the attachment store.
 * @param file - The file to attach.
 * @param workspaceCwd - Absolute workspace root a copy is stored under.
 * @returns The file's chip.
 */
async function attachFile(
	file: File,
	workspaceCwd: string,
): Promise<ComposerAttachment> {
	const absolutePath =
		file.size > SMALL_FILE_MAX_BYTES ? getPathForFile(file) : null;
	if (absolutePath) {
		return {
			absolutePath,
			id: `external:${absolutePath}`,
			kind: 'external-file',
			label: file.name || basename(absolutePath),
			sizeBytes: file.size,
		};
	}
	const saved = await saveCopy(file, workspaceCwd);
	return workspaceFileAttachment(toWorkspaceFileSummary(saved));
}

/**
 * Turns a dropped folder into a folder chip. A folder inside the workspace is
 * referenced by its workspace-relative path, exactly as an @-mentioned folder
 * is; one outside it has no chip to become, so it is named in the error instead
 * of being read as a file and failing.
 * @param folder - The dropped folder.
 * @param workspaceCwd - Absolute workspace root the chip's path resolves against.
 * @returns The folder chip, or the message naming a folder outside the workspace.
 */
function attachDroppedFolder(
	folder: File,
	workspaceCwd: string,
): { attachment: ComposerAttachment } | { error: string } {
	const absolutePath = getPathForFile(folder);
	const relativePath = workspaceRelativePath(absolutePath, workspaceCwd);
	const name = folder.name || basename(absolutePath);
	if (!relativePath) {
		return { error: folderOutsideWorkspaceMessage(name) };
	}
	return {
		attachment: workspaceFileAttachment({
			kind: 'directory',
			name,
			path: relativePath,
		}),
	};
}

/**
 * Re-expresses an absolute path relative to the workspace root.
 * @param absolutePath - Absolute path of a dropped item, or empty when unknown.
 * @param workspaceCwd - Absolute workspace root.
 * @returns The workspace-relative path, `.` for the root itself, or null when
 *   the path is unknown or lies outside the workspace.
 */
function workspaceRelativePath(
	absolutePath: string,
	workspaceCwd: string,
): string | null {
	const root = workspaceCwd.replace(/\/+$/, '');
	if (!absolutePath || !root) {
		return null;
	}
	if (absolutePath === root) {
		return '.';
	}
	return absolutePath.startsWith(`${root}/`)
		? absolutePath.slice(root.length + 1)
		: null;
}
