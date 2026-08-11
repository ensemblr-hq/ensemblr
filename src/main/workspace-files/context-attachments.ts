/**
 * Content-addressed store for composer attachments under
 * `.context/attachments/`. Every payload is keyed by a prefix of its SHA-256
 * digest, so two files that happen to share a name never collide and a payload
 * already on disk is reused instead of written a second time.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
	link,
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type {
	WorkspaceFileEntryWire,
	WriteWorkspaceActionPromptRequest,
	WriteWorkspaceActionPromptResult,
	WriteWorkspaceFileAttachmentRequest,
	WriteWorkspaceFileAttachmentResult,
	WriteWorkspaceImageAttachmentRequest,
	WriteWorkspaceImageAttachmentResult,
} from '../../shared/ipc/contracts/workspace-files';
import { resolveWorkspaceCwd } from './workspace-cwd.ts';
import {
	extensionForImageMimeType,
	imageSignatureMatches,
	MAX_CONTEXT_IMAGE_BYTES,
} from './workspace-images.ts';
import {
	hasErrorCode,
	ignoredEntry,
	isWithinWorkspaceReal,
	resolveWorkspacePath,
} from './workspace-paths.ts';

const CONTEXT_ATTACHMENTS_DIR = '.context/attachments';
// Absolute ceiling for a copied attachment. The renderer references files
// larger than SMALL_FILE_MAX_BYTES by absolute path, and only falls back to
// copying an oversized in-memory paste (no resolvable path) up to this cap.
const HARD_MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
/**
 * Digest prefix lengths tried in order for the hash folder. Six hex chars is
 * short enough to stay readable in a prompt and wide enough that a collision
 * between two attachments *sharing a filename* is vanishingly rare; the longer
 * prefixes exist so that when one does happen the resolution is deterministic
 * rather than a name suffix that two racing writers could disagree on.
 */
const HASH_PREFIX_LENGTHS = [6, 8, 10, 12, 16, 64] as const;
/**
 * Marks the half-written scratch file the store links into place from. Skipped
 * by the reuse scan so a peer mid-write is never mistaken for a stored payload.
 */
const TEMP_ENTRY_PREFIX = '.tmp-';

/** Outcome of placing one payload in the store. */
interface StoredAttachment {
	file: WorkspaceFileEntryWire;
	/** True when the payload was already on disk and nothing new was written. */
	reused: boolean;
	sizeBytes: number;
}

/** Typed failure shared by every write path in this module. */
interface AttachmentFailure {
	error: {
		code: 'invalid-cwd' | 'invalid-path' | 'write-failed';
		message: string;
	};
}

/**
 * Persists a pasted image under the workspace's content-addressed attachment
 * store after validating that its bytes really are the image type it claims.
 * @param request - The decoded-payload request from the renderer.
 * @returns The stored file row, or a typed failure.
 */
export async function writeContextImageAttachment(
	request: WriteWorkspaceImageAttachmentRequest,
): Promise<WriteWorkspaceImageAttachmentResult> {
	const cwdResult = resolveWorkspaceCwd(request.workspaceCwd);
	if (!cwdResult.ok) {
		return { error: { code: 'invalid-cwd', message: cwdResult.message } };
	}

	const validated = validatePastedImage(
		request.mimeType,
		request.contentBase64,
	);
	if (!validated.ok) {
		return { error: validated.error, sizeBytes: validated.sizeBytes };
	}

	const stem = sanitizeAttachmentStem(
		request.name ? path.parse(request.name).name : 'pasted-image',
	);
	return persistContentAddressed({
		buffer: validated.buffer,
		name: `${stem}.${validated.extension}`,
		workspaceCwd: cwdResult.cwd,
		writeFailedMessage: 'Failed to write pasted image.',
	});
}

/**
 * Persists a pasted non-image file under the workspace's content-addressed
 * attachment store.
 * @param request - The base64 payload and original filename from the renderer.
 * @returns The stored file row, or a typed failure.
 */
export async function writeContextFileAttachment(
	request: WriteWorkspaceFileAttachmentRequest,
): Promise<WriteWorkspaceFileAttachmentResult> {
	const cwdResult = resolveWorkspaceCwd(request.workspaceCwd);
	if (!cwdResult.ok) {
		return { error: { code: 'invalid-cwd', message: cwdResult.message } };
	}

	const buffer = decodeBase64Payload(request.contentBase64);
	if (!buffer) {
		return {
			error: {
				code: 'invalid-attachment',
				message: 'Pasted attachment could not be decoded.',
			},
		};
	}
	if (buffer.length > HARD_MAX_ATTACHMENT_BYTES) {
		return {
			error: { code: 'too-large', message: 'Attachment is too large to add.' },
			sizeBytes: buffer.length,
		};
	}

	const parsed = request.name
		? path.parse(request.name)
		: { ext: '', name: '' };
	const stem = sanitizeAttachmentStem(parsed.name, 'attachment');
	const extension = resolveAttachmentExtension(parsed.ext, buffer);
	return persistContentAddressed({
		buffer,
		name: `${stem}.${extension}`,
		workspaceCwd: cwdResult.cwd,
		writeFailedMessage: 'Failed to write pasted attachment.',
	});
}

/**
 * Persists a composed action prompt at a stable per-action path, overwriting any
 * prior run. Deliberately outside the content-addressed store: the path is what
 * makes a re-run replace its predecessor instead of accumulating one folder per
 * revision of the same prompt.
 * @param request - The action name and composed prompt body.
 * @returns The written file row, or a typed failure.
 */
export async function writeContextActionPrompt(
	request: WriteWorkspaceActionPromptRequest,
): Promise<WriteWorkspaceActionPromptResult> {
	const cwdResult = resolveWorkspaceCwd(request.workspaceCwd);
	if (!cwdResult.ok) {
		return { error: { code: 'invalid-cwd', message: cwdResult.message } };
	}
	const stem = sanitizeAttachmentStem(request.action, 'action');
	const relativePath = `${CONTEXT_ATTACHMENTS_DIR}/ensemblr-${stem}.md`;
	try {
		const prepared = await prepareContextSubdir(cwdResult.cwd, 'attachments');
		if (!prepared.ok) {
			return { error: prepared.error };
		}
		const target = resolveWorkspacePath({
			pathValue: relativePath,
			workspaceCwd: cwdResult.cwd,
		});
		if (!target.ok) {
			return { error: { code: 'invalid-path', message: target.message } };
		}
		await writeFile(target.absolutePath, request.content, { flag: 'w' });
		return { file: ignoredEntry(target.relativePath, 'file') };
	} catch (cause) {
		return {
			error: describeWriteFailure(cause, 'Failed to write action prompt.'),
		};
	}
}

/**
 * Places a payload in the content-addressed store, walking to a longer digest
 * prefix whenever the chosen filename inside a hash folder is already taken by
 * different bytes. Escalation is a pure function of the content, so two writers
 * racing on the same payload converge on the same path.
 * @param buffer - Decoded bytes to store.
 * @param name - Sanitized `stem.ext` filename to store the payload under.
 * @param workspaceCwd - Absolute workspace root.
 * @param writeFailedMessage - Fallback message when the write throws a non-Error.
 * @returns The stored file row, or a typed failure.
 */
async function persistContentAddressed({
	buffer,
	name,
	workspaceCwd,
	writeFailedMessage,
}: {
	buffer: Buffer;
	name: string;
	workspaceCwd: string;
	writeFailedMessage: string;
}): Promise<StoredAttachment | AttachmentFailure> {
	const digest = createHash('sha256').update(buffer).digest('hex');
	try {
		for (const prefixLength of HASH_PREFIX_LENGTHS) {
			const hashDir = `${CONTEXT_ATTACHMENTS_DIR}/${digest.slice(0, prefixLength)}`;
			const prepared = await prepareContextSubdir(
				workspaceCwd,
				hashDir.slice('.context/'.length),
			);
			if (!prepared.ok) {
				return { error: prepared.error };
			}
			const target = resolveWorkspacePath({
				pathValue: hashDir,
				workspaceCwd,
			});
			if (!target.ok) {
				return { error: { code: 'invalid-path', message: target.message } };
			}
			const placed = await placeAttachment({
				buffer,
				directory: target.absolutePath,
				name,
			});
			if (placed !== 'name-taken') {
				return {
					file: ignoredEntry(`${hashDir}/${name}`, 'file'),
					reused: placed === 'reused',
					sizeBytes: buffer.length,
				};
			}
		}
		return {
			error: {
				code: 'write-failed',
				message: 'Could not find a free path for this attachment.',
			},
		};
	} catch (cause) {
		return { error: describeWriteFailure(cause, writeFailedMessage) };
	}
}

/**
 * Stores `buffer` at `<directory>/<name>`, sharing bytes with an identical
 * sibling when one is already there. Reports `name-taken` when the name belongs
 * to different content, which is the caller's signal to escalate the hash
 * folder.
 *
 * Runs twice because a lost link race and a genuine collision look identical
 * from the failing `link` alone: the second scan sees whatever the winner wrote
 * and resolves a race to `reused`, while a real collision fails the same way
 * both times.
 * @param buffer - Decoded bytes to store.
 * @param directory - Absolute hash-folder path, already created and validated.
 * @param name - Filename to store the payload under.
 * @returns Whether the payload was reused, freshly written, or blocked by the name.
 */
async function placeAttachment({
	buffer,
	directory,
	name,
}: {
	buffer: Buffer;
	directory: string;
	name: string;
}): Promise<'name-taken' | 'reused' | 'written'> {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const placed = await attemptPlacement({ buffer, directory, name });
		if (placed !== 'name-taken') {
			return placed;
		}
	}
	return 'name-taken';
}

/**
 * One pass of the scan-then-link cycle: reuse an identical sibling if the folder
 * already holds one, otherwise stage the bytes and link them into place.
 * @param buffer - Decoded bytes to store.
 * @param directory - Absolute hash-folder path.
 * @param name - Filename to store the payload under.
 * @returns The outcome of this single attempt.
 */
async function attemptPlacement({
	buffer,
	directory,
	name,
}: {
	buffer: Buffer;
	directory: string;
	name: string;
}): Promise<'name-taken' | 'reused' | 'written'> {
	const identicalName = await findIdenticalEntry(directory, buffer);
	if (identicalName === name) {
		return 'reused';
	}
	const target = path.join(directory, name);
	if (identicalName) {
		const linked = await linkUnlessTaken(
			path.join(directory, identicalName),
			target,
		);
		return linked ? 'written' : 'name-taken';
	}
	const scratchPath = path.join(
		directory,
		`${TEMP_ENTRY_PREFIX}${randomUUID()}`,
	);
	await writeFile(scratchPath, buffer, { flag: 'wx' });
	try {
		return (await linkUnlessTaken(scratchPath, target))
			? 'written'
			: 'name-taken';
	} finally {
		await rm(scratchPath, { force: true });
	}
}

/**
 * Finds a sibling in the hash folder whose bytes match the payload exactly. The
 * size check runs first because it settles nearly every candidate without
 * reading the file, and the survivors are compared byte-for-byte rather than
 * re-hashed — a memcmp is both cheaper and exact.
 * @param directory - Absolute hash-folder path to scan.
 * @param buffer - Decoded bytes to match against.
 * @returns The matching filename, or null when the folder holds no copy.
 */
async function findIdenticalEntry(
	directory: string,
	buffer: Buffer,
): Promise<string | null> {
	const entries = await readdir(directory, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isFile() || entry.name.startsWith(TEMP_ENTRY_PREFIX)) {
			continue;
		}
		const candidatePath = path.join(directory, entry.name);
		const candidateStat = await stat(candidatePath);
		if (candidateStat.size !== buffer.length) {
			continue;
		}
		if ((await readFile(candidatePath)).equals(buffer)) {
			return entry.name;
		}
	}
	return null;
}

/**
 * Hardlinks `source` onto `target`. `link` is the atomic half of the write: it
 * fails `EEXIST` rather than clobbering, and the target is complete the instant
 * it appears, so a concurrent reader can never observe a partial file.
 * @param source - Existing path to link from.
 * @param target - Path to create.
 * @returns True when the link was created, false when the target already exists.
 */
async function linkUnlessTaken(
	source: string,
	target: string,
): Promise<boolean> {
	try {
		await link(source, target);
		return true;
	} catch (cause) {
		if (hasErrorCode(cause, 'EEXIST')) {
			return false;
		}
		throw cause;
	}
}

/**
 * Ensures every level of a workspace `.context/<subdir>/` path exists and — after
 * each `mkdir` — still resolves inside the workspace, guarding against a
 * symlinked `.context` or any nested segment that would redirect writes out of
 * the tree.
 * @param workspaceCwd - Absolute workspace root.
 * @param subdir - Slash-separated path under `.context`, e.g. `attachments/ab12cd`.
 * @returns Success, or the typed failure that stopped the walk.
 */
async function prepareContextSubdir(
	workspaceCwd: string,
	subdir: string,
): Promise<
	| { ok: true }
	| {
			error: { code: 'invalid-cwd' | 'invalid-path'; message: string };
			ok: false;
	  }
> {
	const rootStat = await stat(workspaceCwd);
	if (!rootStat.isDirectory()) {
		return {
			error: {
				code: 'invalid-cwd',
				message: 'Workspace path must be a directory.',
			},
			ok: false,
		};
	}
	let current = workspaceCwd;
	for (const segment of ['.context', ...subdir.split('/')]) {
		current = path.join(current, segment);
		await mkdir(current, { recursive: true });
		if (!(await isWithinWorkspaceReal(workspaceCwd, current))) {
			return {
				error: {
					code: 'invalid-path',
					message:
						'Workspace attachment directory must stay inside the workspace.',
				},
				ok: false,
			};
		}
	}
	return { ok: true };
}

/**
 * Decodes and validates a pasted image payload: known MIME type, well-formed
 * base64, magic-byte signature matching the declared type, and within the size
 * cap.
 * @param mimeType - MIME type declared by the renderer.
 * @param contentBase64 - Base64 body of the pasted image.
 * @returns The decoded buffer and safe extension, or a typed failure.
 */
function validatePastedImage(
	mimeType: string,
	contentBase64: string,
):
	| { buffer: Buffer; extension: string; ok: true }
	| {
			error: { code: 'invalid-image'; message: string };
			ok: false;
			sizeBytes?: number;
	  } {
	const extension = extensionForImageMimeType(mimeType);
	const buffer = decodeBase64Payload(contentBase64);
	if (!extension || !buffer || !imageSignatureMatches(buffer, extension)) {
		return {
			error: {
				code: 'invalid-image',
				message: 'Pasted attachment must be a valid image.',
			},
			ok: false,
		};
	}
	if (buffer.length > MAX_CONTEXT_IMAGE_BYTES) {
		return {
			error: {
				code: 'invalid-image',
				message: 'Pasted image is too large to attach.',
			},
			ok: false,
			sizeBytes: buffer.length,
		};
	}
	return { buffer, extension, ok: true };
}

/**
 * Decodes a renderer-supplied base64 payload after cheap shape checks.
 * @param contentBase64 - Base64 body, possibly containing whitespace.
 * @returns The decoded buffer, or null when the payload is empty or malformed.
 */
function decodeBase64Payload(contentBase64: string): Buffer | null {
	const normalized = contentBase64.replaceAll(/\s/g, '');
	if (
		normalized.length === 0 ||
		normalized.length % 4 === 1 ||
		!BASE64_PATTERN.test(normalized)
	) {
		return null;
	}
	const buffer = Buffer.from(normalized, 'base64');
	return buffer.length > 0 ? buffer : null;
}

/**
 * Normalizes pasted attachment names to a conservative filesystem stem.
 * @param name - Raw filename stem.
 * @param fallback - Stem to use when sanitization leaves nothing.
 * @returns The sanitized stem.
 */
function sanitizeAttachmentStem(
	name: string,
	fallback = 'pasted-image',
): string {
	const stem = name
		.trim()
		.toLowerCase()
		.replaceAll(/[^a-z0-9_-]+/g, '-')
		.replaceAll(/^-+|-+$/g, '')
		.slice(0, 60);
	return stem || fallback;
}

/**
 * Resolves a safe lowercase extension for a pasted file. Prefers the original
 * filename's extension; when it has none, sniffs the payload so extensionless
 * text (Dockerfile, LICENSE, `.env`) is saved as `txt` and inlined downstream
 * rather than announced as an opaque `bin` blob.
 * @param ext - Extension parsed from the original filename (may be empty).
 * @param buffer - Decoded file bytes, sniffed only when `ext` is empty.
 * @returns The extension to store the payload under.
 */
function resolveAttachmentExtension(ext: string, buffer: Buffer): string {
	const cleaned = ext
		.replace(/^\./, '')
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '')
		.slice(0, 16);
	if (cleaned) {
		return cleaned;
	}
	return looksLikeText(buffer) ? 'txt' : 'bin';
}

/**
 * Heuristically classifies a payload as text, mirroring git's binary check: a
 * NUL byte in the leading sample means binary, otherwise treat it as text.
 * @param buffer - Decoded file bytes.
 * @returns True when the leading sample contains no NUL byte.
 */
function looksLikeText(buffer: Buffer): boolean {
	const sample = buffer.subarray(0, 8000);
	return sample.length > 0 && !sample.includes(0);
}

/**
 * Maps a thrown write failure onto the store's typed error, distinguishing a
 * missing workspace root from every other filesystem fault.
 * @param cause - The thrown value.
 * @param fallbackMessage - Message to use when the value is not an Error.
 * @returns The typed error to return to the renderer.
 */
function describeWriteFailure(
	cause: unknown,
	fallbackMessage: string,
): AttachmentFailure['error'] {
	return {
		code: hasErrorCode(cause, 'ENOENT') ? 'invalid-cwd' : 'write-failed',
		message: cause instanceof Error ? cause.message : fallbackMessage,
	};
}
