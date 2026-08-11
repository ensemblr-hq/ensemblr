import {
	getPathForFile,
	writeWorkspaceFileAttachment,
	writeWorkspaceImageAttachment,
} from '@/renderer/api/ensemblr-queries';
import { i18n } from '@/renderer/lib/i18n';
import { issueDocumentFilename } from '@/renderer/lib/workbench/issue-document';
import type {
	ComposerAttachment,
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
 * @param entry - The file-tree row the mention or chip resolved to.
 * @returns The composer attachment for that entry.
 */
export function workspaceFileAttachment(
	entry: WorkspaceFileSummary,
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
 * Builds the attachment for a block of pasted text already written to the
 * store, carrying the preview and line count its chip renders.
 * @param path - Workspace-relative path the text was persisted to.
 * @param text - The full pasted text.
 * @returns The composer attachment for that paste.
 */
function pastedTextAttachment(path: string, text: string): ComposerAttachment {
	return {
		id: `wsfile:${path}`,
		kind: 'pasted-text',
		label: path.split('/').at(-1) ?? path,
		lineCount: text.split('\n').length,
		path,
		preview: text.replace(/^\s*\n+/, '').slice(0, PASTED_TEXT_PREVIEW_CHARS),
	};
}

/**
 * Adds attachments to a list, skipping any whose id is already present so
 * re-attaching the same thing is a no-op rather than a duplicate chip.
 * @param current - The list to extend.
 * @param incoming - Attachments to append.
 * @returns A new list, or `current` unchanged when nothing was new.
 */
export function appendAttachments(
	current: readonly ComposerAttachment[],
	incoming: readonly ComposerAttachment[],
): readonly ComposerAttachment[] {
	const seen = new Set(current.map((entry) => entry.id));
	const added = incoming.filter((entry) => {
		if (seen.has(entry.id)) {
			return false;
		}
		seen.add(entry.id);
		return true;
	});
	return added.length > 0 ? [...current, ...added] : current;
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
 * Writes a rendered issue document into the workspace and returns the chip for
 * it. The whole issue lands on disk, so the agent reads it as a file rather than
 * being handed a summary line and left to fetch the rest itself.
 * @param document - The rendered markdown body.
 * @param provider - Tracker the issue came from, which picks the chip's brand mark.
 * @param reference - Human issue reference, such as `THE-106` or `#42`.
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
