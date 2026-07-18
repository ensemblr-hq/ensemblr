import { randomUUID } from 'node:crypto';
import {
	mkdir,
	readdir,
	readFile,
	realpath,
	stat,
	writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type {
	ListWorkspaceFilesRequest,
	ListWorkspaceFilesResult,
	ReadWorkspaceDirectoryRequest,
	ReadWorkspaceDirectoryResult,
	ReadWorkspaceFileRequest,
	ReadWorkspaceFileResult,
	WorkspaceFileEntryWire,
	WriteWorkspaceActionPromptRequest,
	WriteWorkspaceActionPromptResult,
	WriteWorkspaceFileAttachmentRequest,
	WriteWorkspaceFileAttachmentResult,
	WriteWorkspaceImageAttachmentRequest,
	WriteWorkspaceImageAttachmentResult,
} from '../../shared/ipc/contracts/workspace-files';
import type { LocalCommandService } from '../commands/local-command';

const GIT_ARGS = [
	'ls-files',
	'--cached',
	'--others',
	'--exclude-standard',
	'-z',
] as const;
// Lists git-ignored entries. `--directory` collapses a fully-ignored directory
// to a single trailing-slash root (`.context/`, `node_modules/`) instead of
// enumerating it. We then expand each root's contents from disk up to a cap, so
// reasonably-sized ignored folders are browsable while giant ones (node_modules)
// stay collapsed and never blow up the tree.
const GIT_IGNORED_ARGS = [
	'ls-files',
	'--others',
	'--ignored',
	'--exclude-standard',
	'--directory',
	'-z',
] as const;
const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const MAX_READ_BYTES = 512 * 1024;
const MAX_CONTEXT_IMAGE_BYTES = 10 * 1024 * 1024;
// Absolute ceiling for a copied attachment. The renderer references files
// larger than SMALL_FILE_MAX_BYTES by absolute path, and only falls back to
// copying an oversized in-memory paste (no resolvable path) up to this cap.
const HARD_MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const CONTEXT_IMAGES_DIR = '.context/images';
const CONTEXT_ATTACHMENTS_DIR = '.context/attachments';
const IMAGE_EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
	'image/bmp': 'bmp',
	'image/gif': 'gif',
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/tiff': 'tiff',
	'image/webp': 'webp',
};
const PREVIEW_IMAGE_MIME_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
	avif: 'image/avif',
	bmp: 'image/bmp',
	gif: 'image/gif',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
};
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
// Per-ignored-directory enumeration cap. A small ignored dir expands fully so
// its files are browsable; one that exceeds this bails and stays collapsed.
const IGNORED_ROOT_MAX_ENTRIES = 1000;

/** Service surface for listing and safely reading files within a workspace. */
export interface ListWorkspaceFilesService {
	list: (
		request: ListWorkspaceFilesRequest,
	) => Promise<ListWorkspaceFilesResult>;
	read: (request: ReadWorkspaceFileRequest) => Promise<ReadWorkspaceFileResult>;
	/** Persists a pasted image under `.context/images/` and returns its file row. */
	writeImageAttachment: (
		request: WriteWorkspaceImageAttachmentRequest,
	) => Promise<WriteWorkspaceImageAttachmentResult>;
	/** Persists a pasted non-image file under `.context/attachments/` and returns its file row. */
	writeFileAttachment: (
		request: WriteWorkspaceFileAttachmentRequest,
	) => Promise<WriteWorkspaceFileAttachmentResult>;
	/** Persists a composed action prompt at a stable per-action `.context/attachments/` path, overwriting any prior run. */
	writeActionPrompt: (
		request: WriteWorkspaceActionPromptRequest,
	) => Promise<WriteWorkspaceActionPromptResult>;
	/** Enumerates one directory level for lazy expansion of ignored folders. */
	readDirectory: (
		request: ReadWorkspaceDirectoryRequest,
	) => Promise<ReadWorkspaceDirectoryResult>;
}

/** Options for constructing a {@link ListWorkspaceFilesService}. */
export interface CreateListWorkspaceFilesServiceOptions {
	/** Per-ignored-directory enumeration cap; overridable in tests. */
	ignoredRootMaxEntries?: number;
	localCommandService: LocalCommandService;
}

/**
 * Service that enumerates files tracked or untracked-but-not-ignored in a
 * workspace by shelling out to `git ls-files -z`, safely reads selected files,
 * and persists pasted composer images under `.context/images/`. Caller-supplied
 * cwd must be absolute.
 */
export function createListWorkspaceFilesService({
	ignoredRootMaxEntries = IGNORED_ROOT_MAX_ENTRIES,
	localCommandService,
}: CreateListWorkspaceFilesServiceOptions): ListWorkspaceFilesService {
	return {
		async list(request) {
			const cwdResult = resolveWorkspaceCwd(request.workspaceCwd);
			if (!cwdResult.ok) {
				return {
					error: {
						code: 'invalid-cwd',
						message: cwdResult.message,
					},
					files: [],
				};
			}

			const runGit = (args: readonly string[]) =>
				localCommandService.run({
					args,
					command: 'git',
					cwd: cwdResult.cwd,
					maxOutputBytes: MAX_OUTPUT_BYTES,
					timeoutMs: TIMEOUT_MS,
				});

			const [tracked, ignored] = await Promise.all([
				runGit(GIT_ARGS),
				runGit(GIT_IGNORED_ARGS),
			]);

			if (tracked.status !== 'success') {
				const message =
					tracked.failure?.message ?? 'git ls-files failed in workspace.';
				const stderr = tracked.stderr?.toLowerCase() ?? '';
				if (
					stderr.includes('not a git repository') ||
					stderr.includes('does not have any git working tree')
				) {
					return {
						error: { code: 'not-a-git-repo', message },
						files: [],
					};
				}
				return {
					error: { code: 'command-failed', message },
					files: [],
				};
			}

			const trackedEntries = parseGitLsFiles(tracked.stdout);
			// Ignored listing is best-effort: a failure there must never drop the
			// primary file list, so fall back to no ignored entries.
			const ignoredEntries =
				ignored.status === 'success'
					? await expandIgnoredEntries({
							budget: MAX_ENTRIES - trackedEntries.length,
							rootMaxEntries: ignoredRootMaxEntries,
							stdout: ignored.stdout,
							trackedPaths: new Set(trackedEntries.map((entry) => entry.path)),
							workspaceCwd: cwdResult.cwd,
						})
					: [];
			return { files: [...trackedEntries, ...ignoredEntries] };
		},
		async read(request) {
			const cwdResult = resolveWorkspaceCwd(request.workspaceCwd);
			if (!cwdResult.ok) {
				return {
					error: { code: 'invalid-cwd', message: cwdResult.message },
					path: request.path,
				};
			}

			const target = resolveWorkspacePath({
				pathValue: request.path,
				workspaceCwd: cwdResult.cwd,
			});
			if (!target.ok) {
				return {
					error: { code: 'invalid-path', message: target.message },
					path: request.path,
				};
			}

			try {
				const readable = await resolveReadablePreviewFile({
					absolutePath: target.absolutePath,
					relativePath: target.relativePath,
					requestPath: request.path,
					workspaceCwd: cwdResult.cwd,
				});
				if (!readable.ok) {
					return readable.result;
				}
				return buildFilePreviewResult({
					buffer: await readFile(target.absolutePath),
					previewImageMimeType: readable.previewImageMimeType,
					relativePath: target.relativePath,
					sizeBytes: readable.sizeBytes,
				});
			} catch (cause) {
				const errorCode = hasErrorCode(cause, 'ENOENT')
					? 'not-found'
					: 'read-failed';
				return {
					error: {
						code: errorCode,
						message:
							cause instanceof Error
								? cause.message
								: 'Failed to read workspace file.',
					},
					path: request.path,
				};
			}
		},
		/** Persists a pasted image under the workspace `.context/images/` folder. */
		async writeImageAttachment(request) {
			const cwdResult = resolveWorkspaceCwd(request.workspaceCwd);
			if (!cwdResult.ok) {
				return {
					error: { code: 'invalid-cwd', message: cwdResult.message },
				};
			}

			const validated = validatePastedImage(
				request.mimeType,
				request.contentBase64,
			);
			if (!validated.ok) {
				return { error: validated.error, sizeBytes: validated.sizeBytes };
			}

			return persistContextAttachment({
				buffer: validated.buffer,
				relativePath: `${CONTEXT_IMAGES_DIR}/${buildContextImageFileName({
					extension: validated.extension,
					name: request.name,
				})}`,
				subdir: 'images',
				workspaceCwd: cwdResult.cwd,
				writeFailedMessage: 'Failed to write pasted image.',
			});
		},
		/** Persists a pasted non-image file under the workspace `.context/attachments/` folder. */
		async writeFileAttachment(request) {
			const cwdResult = resolveWorkspaceCwd(request.workspaceCwd);
			if (!cwdResult.ok) {
				return {
					error: { code: 'invalid-cwd', message: cwdResult.message },
				};
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
					error: {
						code: 'too-large',
						message: 'Attachment is too large to add.',
					},
					sizeBytes: buffer.length,
				};
			}

			return persistContextAttachment({
				buffer,
				relativePath: `${CONTEXT_ATTACHMENTS_DIR}/${buildContextAttachmentFileName(
					{ buffer, name: request.name },
				)}`,
				subdir: 'attachments',
				workspaceCwd: cwdResult.cwd,
				writeFailedMessage: 'Failed to write pasted attachment.',
			});
		},
		/** Persists a composed action prompt at a stable per-action path, overwriting any prior run. */
		async writeActionPrompt(request) {
			const cwdResult = resolveWorkspaceCwd(request.workspaceCwd);
			if (!cwdResult.ok) {
				return {
					error: { code: 'invalid-cwd', message: cwdResult.message },
				};
			}
			const stem = sanitizeAttachmentStem(request.action, 'action');
			const result = await persistContextAttachment({
				buffer: Buffer.from(request.content, 'utf8'),
				overwrite: true,
				relativePath: `${CONTEXT_ATTACHMENTS_DIR}/ensemblr-${stem}.md`,
				subdir: 'attachments',
				workspaceCwd: cwdResult.cwd,
				writeFailedMessage: 'Failed to write action prompt.',
			});
			if ('error' in result) {
				return { error: result.error };
			}
			return { file: result.file };
		},
		async readDirectory(request) {
			const cwdResult = resolveWorkspaceCwd(request.workspaceCwd);
			if (!cwdResult.ok) {
				return {
					entries: [],
					error: { code: 'invalid-cwd', message: cwdResult.message },
					path: request.path,
				};
			}

			const target = resolveWorkspacePath({
				pathValue: request.path,
				workspaceCwd: cwdResult.cwd,
			});
			if (!target.ok) {
				return {
					entries: [],
					error: { code: 'invalid-path', message: target.message },
					path: request.path,
				};
			}

			try {
				const dirStat = await stat(target.absolutePath);
				if (!dirStat.isDirectory()) {
					return {
						entries: [],
						error: {
							code: 'not-directory',
							message: 'Selected path is not a directory.',
						},
						path: target.relativePath,
					};
				}
				if (
					!(await isWithinWorkspaceReal(cwdResult.cwd, target.absolutePath))
				) {
					return {
						entries: [],
						error: {
							code: 'invalid-path',
							message:
								'Workspace directory path must stay inside the workspace.',
						},
						path: target.relativePath,
					};
				}
				const dirents = await readdir(target.absolutePath, {
					withFileTypes: true,
				});
				const entries: WorkspaceFileEntryWire[] = [];
				for (const dirent of dirents) {
					const childPath = `${target.relativePath}/${dirent.name}`;
					if (isHiddenEntryPath(childPath)) {
						continue;
					}
					entries.push(
						ignoredEntry(
							childPath,
							dirent.isDirectory() ? 'directory' : 'file',
						),
					);
					if (entries.length >= MAX_ENTRIES) {
						break;
					}
				}
				return { entries, path: target.relativePath };
			} catch (cause) {
				return {
					entries: [],
					error: {
						code: 'read-failed',
						message:
							cause instanceof Error
								? cause.message
								: 'Failed to read workspace directory.',
					},
					path: request.path,
				};
			}
		},
	};
}

/** Parses `git ls-files -z` output into directory rows followed by file rows. */
function parseGitLsFiles(stdout: string): readonly WorkspaceFileEntryWire[] {
	const filePaths: string[] = [];
	const seenFiles = new Set<string>();
	for (const raw of stdout.split('\0')) {
		const trimmed = raw.trim();
		if (!trimmed || seenFiles.has(trimmed) || isHiddenEntryPath(trimmed)) {
			continue;
		}
		seenFiles.add(trimmed);
		filePaths.push(trimmed);
		if (filePaths.length >= MAX_ENTRIES) {
			break;
		}
	}

	const entries: WorkspaceFileEntryWire[] = [];
	const seenEntries = new Set<string>();
	for (const directory of collectDirectories(filePaths)) {
		entries.push({
			kind: 'directory',
			name: directory.split('/').pop() ?? directory,
			path: directory,
		});
		seenEntries.add(directory);
	}
	for (const filePath of filePaths) {
		if (seenEntries.has(filePath)) {
			continue;
		}
		entries.push({
			kind: 'file',
			name: filePath.split('/').pop() ?? filePath,
			path: filePath,
		});
	}
	return entries;
}

/**
 * Splits `git ls-files --ignored --directory -z` output into fully-ignored
 * directory roots (trailing `/`) and individually-ignored files. Hidden junk
 * (`.git`, `.DS_Store`, …) is dropped from both.
 */
function parseIgnoredRoots(stdout: string): {
	files: WorkspaceFileEntryWire[];
	roots: string[];
} {
	const roots: string[] = [];
	const files: WorkspaceFileEntryWire[] = [];
	const seen = new Set<string>();
	for (const raw of stdout.split('\0')) {
		const trimmed = raw.trim();
		if (!trimmed) {
			continue;
		}
		const isDirectory = trimmed.endsWith('/');
		const entryPath = isDirectory ? trimmed.slice(0, -1) : trimmed;
		if (!entryPath || isHiddenEntryPath(entryPath) || seen.has(entryPath)) {
			continue;
		}
		seen.add(entryPath);
		if (isDirectory) {
			roots.push(entryPath);
		} else {
			files.push(ignoredEntry(entryPath, 'file'));
		}
	}
	return { files, roots };
}

/**
 * Builds the ignored portion of the tree: individually-ignored files plus the
 * on-disk contents of each ignored directory root, enumerated up to a per-root
 * cap. Roots that exceed the cap (e.g. `node_modules/`) stay collapsed so the
 * tree never enumerates a giant ignored subtree.
 */
async function expandIgnoredEntries({
	budget,
	rootMaxEntries,
	stdout,
	trackedPaths,
	workspaceCwd,
}: {
	budget: number;
	rootMaxEntries: number;
	stdout: string;
	trackedPaths: ReadonlySet<string>;
	workspaceCwd: string;
}): Promise<WorkspaceFileEntryWire[]> {
	if (budget <= 0) {
		return [];
	}
	const { files, roots } = parseIgnoredRoots(stdout);
	const entries: WorkspaceFileEntryWire[] = [];
	let remaining = budget;

	for (const file of files) {
		if (remaining <= 0) {
			return entries;
		}
		if (!trackedPaths.has(file.path)) {
			entries.push(file);
			remaining -= 1;
		}
	}

	for (const root of roots) {
		if (remaining <= 0) {
			break;
		}
		if (trackedPaths.has(root)) {
			continue;
		}
		const walked = await walkIgnoredRoot(
			workspaceCwd,
			root,
			Math.min(rootMaxEntries, remaining),
		);
		if (walked) {
			entries.push(...walked);
			remaining -= walked.length;
		} else {
			// Too big to enumerate cheaply — leave it collapsed.
			entries.push(ignoredEntry(root, 'directory'));
			remaining -= 1;
		}
	}

	return entries;
}

/**
 * Depth-first reads an ignored directory's descendants from disk, tagging each
 * as ignored. Returns `null` once the subtree exceeds `cap`, signalling the
 * caller to keep the directory collapsed instead.
 */
async function walkIgnoredRoot(
	workspaceCwd: string,
	root: string,
	cap: number,
): Promise<WorkspaceFileEntryWire[] | null> {
	const entries: WorkspaceFileEntryWire[] = [ignoredEntry(root, 'directory')];
	const stack: string[] = [root];

	while (stack.length > 0) {
		const directory = stack.pop();
		if (!directory) {
			break;
		}
		// Unreadable dir (permissions, race) — skip it, keep what we have.
		const dirents = await readdir(path.join(workspaceCwd, directory), {
			withFileTypes: true,
		}).catch(() => null);
		if (!dirents) {
			continue;
		}
		for (const dirent of dirents) {
			const childPath = `${directory}/${dirent.name}`;
			if (isHiddenEntryPath(childPath)) {
				continue;
			}
			const isDirectory = dirent.isDirectory();
			entries.push(ignoredEntry(childPath, isDirectory ? 'directory' : 'file'));
			if (entries.length > cap) {
				return null;
			}
			if (isDirectory) {
				stack.push(childPath);
			}
		}
	}

	return entries;
}

/** Builds an ignored tree entry of the given kind from a repo-relative path. */
function ignoredEntry(
	entryPath: string,
	kind: 'directory' | 'file',
): WorkspaceFileEntryWire {
	return {
		isIgnored: true,
		kind,
		name: entryPath.split('/').pop() ?? entryPath,
		path: entryPath,
	};
}

/** OS/editor junk filenames that should never surface in the tree. */
const HIDDEN_ENTRY_NAMES = new Set([
	'.AppleDouble',
	'.DS_Store',
	'.Spotlight-V100',
	'.Trashes',
	'.fseventsd',
	'.localized',
	'Desktop.ini',
	'Thumbs.db',
	'__MACOSX',
]);

/**
 * True for git metadata and OS/system junk (`.DS_Store`, AppleDouble `._*`,
 * Windows `Thumbs.db`, etc.) that must never appear in the tree — whether the
 * entry is tracked or ignored.
 */
function isHiddenEntryPath(entryPath: string): boolean {
	if (entryPath === '.git' || entryPath.startsWith('.git/')) {
		return true;
	}
	const name = entryPath.split('/').pop() ?? entryPath;
	return HIDDEN_ENTRY_NAMES.has(name) || name.startsWith('._');
}

/** Collects every parent directory represented by a flat git file list. */
function collectDirectories(filePaths: readonly string[]): readonly string[] {
	const directories = new Set<string>();
	for (const filePath of filePaths) {
		const parts = filePath.split('/');
		for (let index = 1; index < parts.length; index += 1) {
			directories.add(parts.slice(0, index).join('/'));
		}
	}
	return [...directories].sort((a, b) => a.localeCompare(b));
}

/** Validates and normalizes an absolute workspace cwd from the renderer. */
function resolveWorkspaceCwd(
	workspaceCwd: string,
): { cwd: string; ok: true } | { message: string; ok: false } {
	const cwd = workspaceCwd?.trim();
	if (!cwd || !path.isAbsolute(cwd)) {
		return {
			message: 'Workspace path must be an absolute filesystem path.',
			ok: false,
		};
	}
	return { cwd, ok: true };
}

/** Resolves a renderer-supplied relative file path inside the workspace. */
function resolveWorkspacePath({
	pathValue,
	workspaceCwd,
}: {
	pathValue: string;
	workspaceCwd: string;
}):
	| { absolutePath: string; ok: true; relativePath: string }
	| { message: string; ok: false } {
	const rawPath = pathValue.trim();
	if (!rawPath || path.isAbsolute(rawPath)) {
		return { message: 'Workspace file path must be relative.', ok: false };
	}
	const normalized = path.normalize(rawPath);
	if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
		return {
			message: 'Workspace file path must stay inside the workspace.',
			ok: false,
		};
	}
	const absolutePath = path.resolve(workspaceCwd, normalized);
	const relativePath = path.relative(workspaceCwd, absolutePath);
	if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`)) {
		return {
			message: 'Workspace file path must stay inside the workspace.',
			ok: false,
		};
	}
	return {
		absolutePath,
		ok: true,
		relativePath: relativePath.split(path.sep).join('/'),
	};
}

/**
 * Confirms a path resolves — through any symlinks — to a location still inside
 * the workspace. {@link resolveWorkspacePath} blocks `..` lexically, but a
 * symlink whose target escapes the workspace would slip past it, so reads must
 * realpath both sides and re-check before touching disk. Both ends are
 * realpath'd so a workspace whose own root is symlinked (e.g. macOS `/tmp` →
 * `/private/tmp`) still resolves legitimate in-tree paths. The target must
 * already exist (callers `stat` first); a realpath failure resolves to "outside".
 */
async function isWithinWorkspaceReal(
	workspaceCwd: string,
	absolutePath: string,
): Promise<boolean> {
	try {
		const [realRoot, realTarget] = await Promise.all([
			realpath(workspaceCwd),
			realpath(absolutePath),
		]);
		if (realTarget === realRoot) {
			return true;
		}
		const relative = path.relative(realRoot, realTarget);
		return (
			relative !== '' &&
			relative !== '..' &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative)
		);
	} catch {
		return false;
	}
}

/** Resolves a safe file extension for a pasted image MIME type. */
function extensionForImageMimeType(mimeType: string): string | null {
	return IMAGE_EXTENSION_BY_MIME_TYPE[mimeType.toLowerCase()] ?? null;
}

/**
 * Returns a browser-previewable image MIME type for a workspace file path.
 * @param filePath - Workspace-relative file path.
 * @returns The image MIME type, or null when the extension is not previewable.
 */
function previewImageMimeTypeForPath(filePath: string): string | null {
	const extension = path.extname(filePath).slice(1).toLowerCase();
	return PREVIEW_IMAGE_MIME_TYPE_BY_EXTENSION[extension] ?? null;
}

/**
 * Validates that a resolved workspace path is a readable, in-workspace file
 * within the preview size cap, returning its preview MIME type on success or a
 * typed failure result. The stat, size, and symlink-containment checks run in
 * the order the security model requires (size cap before the real-path check).
 * @param params - Absolute and workspace-relative paths, the original request
 *   path for error echoing, and the workspace root for containment checks.
 * @returns The preview MIME type and size on success, or a failure result.
 */
async function resolveReadablePreviewFile(params: {
	absolutePath: string;
	relativePath: string;
	requestPath: string;
	workspaceCwd: string;
}): Promise<
	| { ok: true; previewImageMimeType: string | null; sizeBytes: number }
	| { ok: false; result: ReadWorkspaceFileResult }
> {
	const { absolutePath, relativePath, requestPath, workspaceCwd } = params;
	const fileStat = await stat(absolutePath);
	if (!fileStat.isFile()) {
		return {
			ok: false,
			result: {
				error: { code: 'not-file', message: 'Selected path is not a file.' },
				path: requestPath,
				sizeBytes: fileStat.size,
			},
		};
	}
	const previewImageMimeType = previewImageMimeTypeForPath(relativePath);
	const maxPreviewBytes = previewImageMimeType
		? MAX_CONTEXT_IMAGE_BYTES
		: MAX_READ_BYTES;
	if (fileStat.size > maxPreviewBytes) {
		return {
			ok: false,
			result: {
				error: {
					code: 'too-large',
					message: 'Selected file is too large to preview.',
				},
				path: requestPath,
				sizeBytes: fileStat.size,
			},
		};
	}
	if (!(await isWithinWorkspaceReal(workspaceCwd, absolutePath))) {
		return {
			ok: false,
			result: {
				error: {
					code: 'invalid-path',
					message: 'Workspace file path must stay inside the workspace.',
				},
				path: requestPath,
				sizeBytes: fileStat.size,
			},
		};
	}
	return { ok: true, previewImageMimeType, sizeBytes: fileStat.size };
}

/**
 * Builds the preview payload for a validated, in-workspace file: a base64 image
 * result when the bytes match a browser-previewable type, otherwise utf8 source.
 * @param params - Decoded file buffer, its declared preview MIME type (or null),
 *   the workspace-relative path, and the on-disk size in bytes.
 * @returns A base64 image or utf8 source preview result.
 */
function buildFilePreviewResult(params: {
	buffer: Buffer;
	previewImageMimeType: string | null;
	relativePath: string;
	sizeBytes: number;
}): ReadWorkspaceFileResult {
	const { buffer, previewImageMimeType, relativePath, sizeBytes } = params;
	if (
		previewImageMimeType &&
		previewImageBytesLookValid(buffer, relativePath)
	) {
		return {
			content: buffer.toString('base64'),
			contentEncoding: 'base64',
			mimeType: previewImageMimeType,
			path: relativePath,
			sizeBytes,
		};
	}
	return {
		content: buffer.toString('utf8'),
		contentEncoding: 'utf8',
		path: relativePath,
		sizeBytes,
	};
}

/**
 * Confirms a preview file's leading bytes match its declared image type, so a
 * mislabeled text or binary file falls back to the source view instead of a
 * broken `<img>`. Extensions without a known prefix signature (e.g. the AVIF
 * container) are allowed through unvalidated.
 * @param buffer - Decoded file contents.
 * @param filePath - Workspace-relative file path whose extension declares the type.
 * @returns True when the bytes are consistent with the declared image type.
 */
function previewImageBytesLookValid(buffer: Buffer, filePath: string): boolean {
	const extension = signatureExtensionForPreview(filePath);
	if (!extension) {
		return true;
	}
	return imageSignatureMatches(buffer, extension);
}

/**
 * Maps a preview file path to its magic-byte signature key, or null when no
 * prefix signature covers the extension.
 * @param filePath - Workspace-relative file path.
 * @returns A key into the image signature table, or null when unvalidated.
 */
function signatureExtensionForPreview(filePath: string): string | null {
	const extension = path.extname(filePath).slice(1).toLowerCase();
	const normalized = extension === 'jpeg' ? 'jpg' : extension;
	return normalized in IMAGE_SIGNATURES_BY_EXTENSION ? normalized : null;
}

/** Leading-byte magic signatures expected for each supported image extension. */
const IMAGE_SIGNATURES_BY_EXTENSION: Readonly<
	Record<string, readonly (readonly number[])[]>
> = {
	bmp: [[0x42, 0x4d]],
	gif: [[0x47, 0x49, 0x46, 0x38]],
	jpg: [[0xff, 0xd8, 0xff]],
	png: [[0x89, 0x50, 0x4e, 0x47]],
	tiff: [
		[0x49, 0x49, 0x2a, 0x00],
		[0x4d, 0x4d, 0x00, 0x2a],
	],
	webp: [[0x52, 0x49, 0x46, 0x46]],
};

// WebP is a RIFF container, so the RIFF prefix alone also matches WAV/AVI; the
// `WEBP` fourcc at offset 8 disambiguates it from other RIFF payloads.
const WEBP_FOURCC = [0x57, 0x45, 0x42, 0x50] as const;
const WEBP_FOURCC_OFFSET = 8;

/**
 * Confirms decoded bytes begin with a magic signature valid for the declared
 * extension, so a mislabeled non-image cannot be persisted as one and then
 * announced to Pi as an inspectable image.
 */
function imageSignatureMatches(buffer: Buffer, extension: string): boolean {
	const signatures = IMAGE_SIGNATURES_BY_EXTENSION[extension];
	if (!signatures) {
		return false;
	}
	const prefixMatches = signatures.some(
		(signature) =>
			buffer.length >= signature.length &&
			signature.every((byte, index) => buffer[index] === byte),
	);
	if (!prefixMatches) {
		return false;
	}
	if (extension === 'webp') {
		return WEBP_FOURCC.every(
			(byte, index) => buffer[WEBP_FOURCC_OFFSET + index] === byte,
		);
	}
	return prefixMatches;
}

/**
 * Decodes and validates a pasted image payload: known MIME type, well-formed
 * base64, magic-byte signature matching the declared type, and within the size
 * cap. Returns the decoded buffer and safe extension, or a typed failure.
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
 * Ensures a workspace `.context/<subdir>/` directory exists and — after every
 * `mkdir` — still resolves inside the workspace, guarding against a symlinked
 * `.context` or subdir that would redirect writes out of the tree.
 * @param workspaceCwd - Absolute workspace root.
 * @param subdir - Child of `.context` to create (e.g. `images`, `attachments`).
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
	const contextRoot = path.join(workspaceCwd, '.context');
	await mkdir(contextRoot, { recursive: true });
	if (!(await isWithinWorkspaceReal(workspaceCwd, contextRoot))) {
		return {
			error: {
				code: 'invalid-path',
				message: 'Workspace context directory must stay inside the workspace.',
			},
			ok: false,
		};
	}
	const targetDir = path.join(contextRoot, subdir);
	await mkdir(targetDir, { recursive: true });
	if (!(await isWithinWorkspaceReal(workspaceCwd, targetDir))) {
		return {
			error: {
				code: 'invalid-path',
				message:
					'Workspace attachment directory must stay inside the workspace.',
			},
			ok: false,
		};
	}
	return { ok: true };
}

/**
 * Writes a validated attachment buffer to `.context/<subdir>/<relativePath>` and
 * returns the ignored file row. Shared by the image and file writers, which
 * differ only in validation and filename derivation; the write, in-tree path
 * re-check, `stat`, and error mapping are identical.
 * @param buffer - Decoded bytes to persist.
 * @param relativePath - Repo-relative destination path under `.context/`.
 * @param subdir - Child of `.context` the write targets (e.g. `images`).
 * @param workspaceCwd - Absolute workspace root.
 * @param writeFailedMessage - Fallback message when the write throws a non-Error.
 */
async function persistContextAttachment({
	buffer,
	overwrite = false,
	relativePath,
	subdir,
	workspaceCwd,
	writeFailedMessage,
}: {
	buffer: Buffer;
	/** When true, replace an existing file at `relativePath` instead of failing. */
	overwrite?: boolean;
	relativePath: string;
	subdir: string;
	workspaceCwd: string;
	writeFailedMessage: string;
}): Promise<
	| { file: WorkspaceFileEntryWire; sizeBytes: number }
	| {
			error: {
				code: 'invalid-cwd' | 'invalid-path' | 'write-failed';
				message: string;
			};
	  }
> {
	try {
		const prepared = await prepareContextSubdir(workspaceCwd, subdir);
		if (!prepared.ok) {
			return { error: prepared.error };
		}
		const target = resolveWorkspacePath({
			pathValue: relativePath,
			workspaceCwd,
		});
		if (!target.ok) {
			return { error: { code: 'invalid-path', message: target.message } };
		}
		await writeFile(target.absolutePath, buffer, {
			flag: overwrite ? 'w' : 'wx',
		});
		const fileStat = await stat(target.absolutePath);
		return {
			file: ignoredEntry(target.relativePath, 'file'),
			sizeBytes: fileStat.size,
		};
	} catch (cause) {
		return {
			error: {
				code: hasErrorCode(cause, 'ENOENT') ? 'invalid-cwd' : 'write-failed',
				message: cause instanceof Error ? cause.message : writeFailedMessage,
			},
		};
	}
}

/** Decodes a renderer-supplied base64 payload after cheap shape checks. */
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

/** Builds a collision-resistant `.context/images/` basename for a pasted image. */
function buildContextImageFileName({
	extension,
	name,
}: {
	extension: string;
	name?: string;
}): string {
	const stem = sanitizeAttachmentStem(
		name ? path.parse(name).name : 'pasted-image',
	);
	return `${stem}-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
}

/**
 * Builds a collision-resistant `.context/attachments/` basename for a pasted
 * file, deriving the stem from the original filename and the extension from the
 * filename or, when it has none, from sniffing the payload.
 * @param buffer - Decoded file bytes, used to sniff text vs binary when the name lacks an extension.
 * @param name - Original filename supplied by the renderer, if any.
 */
function buildContextAttachmentFileName({
	buffer,
	name,
}: {
	buffer: Buffer;
	name?: string;
}): string {
	const parsed = name ? path.parse(name) : { ext: '', name: '' };
	const stem = sanitizeAttachmentStem(parsed.name, 'attachment');
	const extension = resolveAttachmentExtension(parsed.ext, buffer);
	return `${stem}-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
}

/**
 * Normalizes pasted attachment names to a conservative filesystem stem.
 * @param name - Raw filename stem.
 * @param fallback - Stem to use when sanitization leaves nothing.
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
 */
function looksLikeText(buffer: Buffer): boolean {
	const sample = buffer.subarray(0, 8000);
	return sample.length > 0 && !sample.includes(0);
}

/** Checks unknown thrown values for a Node-style error code. */
function hasErrorCode(cause: unknown, code: string): boolean {
	return (
		typeof cause === 'object' &&
		cause !== null &&
		'code' in cause &&
		cause.code === code
	);
}
