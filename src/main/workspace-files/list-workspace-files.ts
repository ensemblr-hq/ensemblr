import { readdir, readFile, stat } from 'node:fs/promises';
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
import {
	PREVIEW_PDF_MIME_TYPE,
	pdfBytesLookValid,
	previewEmbedMimeTypeForPath,
} from '../../shared/preview-media.ts';
import type { LocalCommandService } from '../commands/local-command';
import {
	writeContextActionPrompt,
	writeContextFileAttachment,
	writeContextImageAttachment,
} from './context-attachments.ts';
import { resolveWorkspaceCwd } from './workspace-cwd.ts';
import {
	imageSignatureMatches,
	MAX_CONTEXT_IMAGE_BYTES,
	signatureExtensionForPreview,
} from './workspace-images.ts';
import type { PreviewPathScope } from './workspace-paths.ts';
import {
	hasErrorCode,
	ignoredEntry,
	isWithinWorkspaceReal,
	resolvePreviewPath,
	resolveWorkspacePath,
} from './workspace-paths.ts';

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
// Per-ignored-directory enumeration cap. A small ignored dir expands fully so
// its files are browsable; one that exceeds this bails and stays collapsed.
// Content-addressed attachments each add a hash folder under `.context/`, so
// this is the budget that decides how deep that tree stays browsable.
const IGNORED_ROOT_MAX_ENTRIES = 2000;

/** Service surface for listing and safely reading files within a workspace. */
export interface ListWorkspaceFilesService {
	list: (
		request: ListWorkspaceFilesRequest,
	) => Promise<ListWorkspaceFilesResult>;
	read: (request: ReadWorkspaceFileRequest) => Promise<ReadWorkspaceFileResult>;
	/** Persists a pasted image in the content-addressed attachment store and returns its file row. */
	writeImageAttachment: (
		request: WriteWorkspaceImageAttachmentRequest,
	) => Promise<WriteWorkspaceImageAttachmentResult>;
	/** Persists a pasted non-image file in the content-addressed attachment store and returns its file row. */
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
 * and hands composer attachments to the content-addressed store in
 * `context-attachments.ts`. Caller-supplied cwd must be absolute.
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

			const target = resolvePreviewPath({
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
					displayPath: target.displayPath,
					requestPath: request.path,
					scope: target.scope,
					workspaceCwd: cwdResult.cwd,
				});
				if (!readable.ok) {
					return readable.result;
				}
				return buildFilePreviewResult({
					buffer: await readFile(target.absolutePath),
					displayPath: target.displayPath,
					isExternal: target.scope === 'external',
					previewEmbedMimeType: readable.previewEmbedMimeType,
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
		writeImageAttachment: writeContextImageAttachment,
		writeFileAttachment: writeContextFileAttachment,
		writeActionPrompt: writeContextActionPrompt,
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

/**
 * Validates that a resolved path is a readable file within the preview size cap,
 * returning its preview MIME type on success or a typed failure result. The
 * stat, size, and symlink-containment checks run in the order the security model
 * requires (size cap before the real-path check). Containment applies only to a
 * `workspace`-scoped path: an `external` one was already cleared to live outside
 * the root, so re-checking it would refuse every file it exists to allow.
 * @param params - Absolute path, the path to echo in errors, the original
 *   request path, the resolved scope, and the workspace root.
 * @returns The preview MIME type and size on success, or a failure result.
 */
async function resolveReadablePreviewFile(params: {
	absolutePath: string;
	displayPath: string;
	requestPath: string;
	scope: PreviewPathScope;
	workspaceCwd: string;
}): Promise<
	| { ok: true; previewEmbedMimeType: string | null; sizeBytes: number }
	| { ok: false; result: ReadWorkspaceFileResult }
> {
	const { absolutePath, displayPath, requestPath, scope, workspaceCwd } =
		params;
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
	const previewEmbedMimeType = previewEmbedMimeTypeForPath(displayPath);
	const maxPreviewBytes = previewEmbedMimeType
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
	if (
		scope === 'workspace' &&
		!(await isWithinWorkspaceReal(workspaceCwd, absolutePath))
	) {
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
	return { ok: true, previewEmbedMimeType, sizeBytes: fileStat.size };
}

/**
 * Builds the preview payload for a validated file: a base64 image result when
 * the bytes match a browser-previewable type, otherwise utf8 source.
 * @param params - Decoded file buffer, its declared preview MIME type (or null),
 *   the path to echo back, whether that path is outside the workspace, and the
 *   on-disk size in bytes.
 * @returns A base64 image or utf8 source preview result.
 */
function buildFilePreviewResult(params: {
	buffer: Buffer;
	displayPath: string;
	isExternal: boolean;
	previewEmbedMimeType: string | null;
	sizeBytes: number;
}): ReadWorkspaceFileResult {
	const { buffer, displayPath, isExternal, previewEmbedMimeType, sizeBytes } =
		params;
	if (
		previewEmbedMimeType &&
		previewBytesLookValid(buffer, displayPath, previewEmbedMimeType)
	) {
		return {
			content: buffer.toString('base64'),
			contentEncoding: 'base64',
			isExternal,
			mimeType: previewEmbedMimeType,
			path: displayPath,
			sizeBytes,
		};
	}
	return {
		content: buffer.toString('utf8'),
		contentEncoding: 'utf8',
		isExternal,
		path: displayPath,
		sizeBytes,
	};
}

/**
 * Confirms a preview file's leading bytes match the type its extension declares,
 * so a mislabeled text or binary file falls back to the source view instead of a
 * broken `<img>` or an embedded viewer fed something that is not a document.
 * Extensions without a known prefix signature (e.g. the AVIF container) are
 * allowed through unvalidated.
 * @param buffer - Decoded file contents.
 * @param filePath - Workspace-relative file path whose extension declares the type.
 * @param mimeType - The preview MIME type resolved for that extension.
 * @returns True when the bytes are consistent with the declared type.
 */
function previewBytesLookValid(
	buffer: Buffer,
	filePath: string,
	mimeType: string,
): boolean {
	if (mimeType === PREVIEW_PDF_MIME_TYPE) {
		return pdfBytesLookValid(buffer);
	}
	const extension = signatureExtensionForPreview(filePath);
	if (!extension) {
		return true;
	}
	return imageSignatureMatches(buffer, extension);
}
