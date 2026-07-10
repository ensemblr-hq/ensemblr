import {
	getPathForFile,
	writeWorkspaceFileAttachment,
	writeWorkspaceImageAttachment,
} from '@/renderer/api/ensemblr-queries';
import type {
	ExternalAttachment,
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
 * Outcome of persisting a batch of pasted/dropped files: copied files become
 * workspace-file chips, large resolvable files become path-only externals, and
 * the first failure (if any) surfaces as a user-facing message.
 */
export interface AttachPastedFilesResult {
	error: string | null;
	savedExternals: ExternalAttachment[];
	savedFiles: WorkspaceFileSummary[];
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

/** Reads a browser File as the base64 body of a data URL. */
function readFileAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener('load', () => {
			const result = reader.result;
			if (typeof result !== 'string') {
				reject(new Error('Pasted file could not be read.'));
				return;
			}
			const separatorIndex = result.indexOf(',');
			if (separatorIndex === -1) {
				reject(new Error('Pasted file payload was malformed.'));
				return;
			}
			resolve(result.slice(separatorIndex + 1));
		});
		reader.addEventListener('error', () => {
			reject(reader.error ?? new Error('Pasted file could not be read.'));
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

/** Copies one file into the workspace, choosing the image or file write path. */
async function saveCopy(
	file: File,
	workspaceCwd: string,
): Promise<WorkspaceFileSummary> {
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
		throw new Error(result.error?.message ?? 'Pasted file could not be saved.');
	}
	return toWorkspaceFileSummary(result.file);
}

/**
 * Persists pasted/dropped files: small ones are copied into the workspace
 * (raster images under `.context/images/`, everything else under
 * `.context/attachments/`); large ones are referenced by absolute path when
 * resolvable, otherwise copied as a fallback. Files saved before a failure are
 * still returned alongside the error so partial success is preserved.
 * @param files - The pasted or dropped files to persist.
 * @param workspaceCwd - Absolute workspace root the files belong to.
 */
export async function attachPastedFiles(
	files: readonly File[],
	workspaceCwd: string,
): Promise<AttachPastedFilesResult> {
	const savedFiles: WorkspaceFileSummary[] = [];
	const savedExternals: ExternalAttachment[] = [];
	let error: string | null = null;
	try {
		for (const file of files) {
			if (file.size > SMALL_FILE_MAX_BYTES) {
				const absolutePath = getPathForFile(file);
				if (absolutePath) {
					savedExternals.push({
						absolutePath,
						name: file.name || basename(absolutePath),
						sizeBytes: file.size,
					});
					continue;
				}
			}
			savedFiles.push(await saveCopy(file, workspaceCwd));
		}
	} catch (cause) {
		error =
			cause instanceof Error
				? cause.message
				: 'Pasted file could not be saved.';
	}
	return { error, savedExternals, savedFiles };
}
