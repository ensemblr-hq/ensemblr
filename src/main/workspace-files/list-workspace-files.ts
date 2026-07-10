import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
	ListWorkspaceFilesRequest,
	ListWorkspaceFilesResult,
	ReadWorkspaceDirectoryRequest,
	ReadWorkspaceDirectoryResult,
	ReadWorkspaceFileRequest,
	ReadWorkspaceFileResult,
	WorkspaceFileEntryWire,
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
// Per-ignored-directory enumeration cap. A small ignored dir expands fully so
// its files are browsable; one that exceeds this bails and stays collapsed.
const IGNORED_ROOT_MAX_ENTRIES = 1000;

/** Service surface for listing and safely reading files within a workspace. */
export interface ListWorkspaceFilesService {
	list: (
		request: ListWorkspaceFilesRequest,
	) => Promise<ListWorkspaceFilesResult>;
	read: (request: ReadWorkspaceFileRequest) => Promise<ReadWorkspaceFileResult>;
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
 * workspace by shelling out to `git ls-files -z`, and safely reads selected
 * files for composer attachments. Caller-supplied cwd must be absolute.
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
				const fileStat = await stat(target.absolutePath);
				if (!fileStat.isFile()) {
					return {
						error: {
							code: 'not-file',
							message: 'Selected path is not a file.',
						},
						path: request.path,
						sizeBytes: fileStat.size,
					};
				}
				if (fileStat.size > MAX_READ_BYTES) {
					return {
						error: {
							code: 'too-large',
							message: 'Selected file is too large to attach.',
						},
						path: request.path,
						sizeBytes: fileStat.size,
					};
				}
				if (
					!(await isWithinWorkspaceReal(cwdResult.cwd, target.absolutePath))
				) {
					return {
						error: {
							code: 'invalid-path',
							message: 'Workspace file path must stay inside the workspace.',
						},
						path: request.path,
						sizeBytes: fileStat.size,
					};
				}
				return {
					content: await readFile(target.absolutePath, 'utf8'),
					path: target.relativePath,
					sizeBytes: fileStat.size,
				};
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

/** Checks unknown thrown values for a Node-style error code. */
function hasErrorCode(cause: unknown, code: string): boolean {
	return (
		typeof cause === 'object' &&
		cause !== null &&
		'code' in cause &&
		cause.code === code
	);
}
