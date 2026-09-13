import type { Dirent } from 'node:fs';
import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
	ListWorkspaceFilesRequest,
	ListWorkspaceFilesResult,
	ReadWorkspaceDirectoryRequest,
	ReadWorkspaceDirectoryResult,
	ReadWorkspaceFileBinaryReason,
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
	bytesLookLikeText,
	imageMimeTypeForPath,
	PREVIEW_PDF_MIME_TYPE,
	pdfBytesLookValid,
	previewEmbedMimeTypeForPath,
} from '../../shared/preview-media.ts';
import type { LocalCommandResult } from '../commands/command-types';
import type { LocalCommandService } from '../commands/local-command';
import {
	writeContextActionPrompt,
	writeContextFileAttachment,
	writeContextImageAttachment,
} from './context-attachments.ts';
import { annotateSymlinkTargets } from './symlink-metadata.ts';
import { resolveWorkspaceCwd } from './workspace-cwd.ts';
import {
	imageSignatureMatches,
	MAX_CONTEXT_IMAGE_BYTES,
	signatureExtensionForPreview,
} from './workspace-images.ts';
import type { PreviewPathScope } from './workspace-paths.ts';
import {
	hasErrorCode,
	hasSymlinkedAncestor,
	ignoredEntry,
	isWithinWorkspaceReal,
	resolvePreviewPath,
	resolveWorkspacePath,
} from './workspace-paths.ts';

// `--stage` prefixes every indexed entry with its mode, so a tracked symlink is
// identified by `120000` from the index instead of an lstat per listed file.
// `--others` entries print as a bare path in the same stream, which is exactly
// the set that still needs probing.
const GIT_ARGS = [
	'ls-files',
	'--cached',
	'--others',
	'--exclude-standard',
	'--stage',
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
// Lists index entries whose worktree file is gone. `--cached` above enumerates
// the index, so a file deleted or moved without staging is still listed there;
// subtracting this set is what keeps a `mv`d directory from showing at both its
// old and new path until the move is committed. It must be its own invocation:
// adding `--deleted` to the primary call would add a category, not filter one.
const GIT_DELETED_ARGS = ['ls-files', '--deleted', '-z'] as const;
// Lists tracked paths whose worktree type no longer matches the index — a
// symlink replaced by a regular file, or the reverse. `--stage` reports the
// index mode, which is stale for exactly these paths, so the mode must not
// decide their badge and an lstat has to settle them instead.
const GIT_TYPECHANGED_ARGS = [
	'diff-files',
	'--diff-filter=T',
	'--name-only',
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
/**
 * How long a cached listing stands without an explicit invalidation.
 *
 * The file watcher is the real invalidation — it fires within 250 ms of a write
 * and already broadcasts the same change to the renderer — so this only bounds
 * the case where the watcher never armed or errored out. Long enough that the
 * renderer's 30 s poll is a cache hit, short enough that a dead watcher costs a
 * stale tree for a minute rather than for the run.
 */
const LISTING_CACHE_TTL_MS = 60_000;

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
	/**
	 * Drops a workspace's cached listing so the next {@link list} re-reads the
	 * tree. Called by whatever observes the worktree changing — in production the
	 * file watcher, which already broadcasts the same event to the renderer.
	 */
	invalidate: (workspaceCwd: string) => void;
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
 *
 * The listing describes the worktree rather than the index: entries `--cached`
 * still carries for a file that was deleted or moved without staging are
 * subtracted, so a `mv`d directory does not show at both its old and new path.
 */
export function createListWorkspaceFilesService({
	ignoredRootMaxEntries = IGNORED_ROOT_MAX_ENTRIES,
	localCommandService,
}: CreateListWorkspaceFilesServiceOptions): ListWorkspaceFilesService {
	/**
	 * Successful listings by resolved cwd. One listing is four `git ls-files`
	 * spawns plus a depth-first walk of every ignored root, and it was repeated
	 * in full for every watcher broadcast and every 30 s poll even when nothing
	 * had moved. Invalidated by {@link ListWorkspaceFilesService.invalidate}, and
	 * by {@link LISTING_CACHE_TTL_MS} so a watcher that died does not freeze the
	 * tree for the rest of the run.
	 */
	const listings = new Map<
		string,
		{ at: number; result: ListWorkspaceFilesResult }
	>();
	/** Listings currently being built, so concurrent callers share one. */
	const listingsInFlight = new Map<string, Promise<ListWorkspaceFilesResult>>();
	/**
	 * Ignored roots last seen to exceed the per-root enumeration cap, keyed by
	 * workspace-relative path and holding the root's mtime at the time.
	 *
	 * The walk that produces that verdict is thrown away — the point is to keep
	 * the directory collapsed — and it measured 5-14.5 ms across 66 `readdir`
	 * calls for a `node_modules`, repeated identically on every listing. A root
	 * that later drops below the cap without its own mtime moving stays
	 * collapsed until it does, which is the same thing the user was already
	 * looking at.
	 */
	const oversizedIgnoredRoots = new Map<string, number>();

	/**
	 * Builds one workspace's listing from git and the ignored-root walk.
	 * @param cwd - Resolved absolute workspace root.
	 * @returns The listing, or the failure that stopped it.
	 */
	async function buildListing(cwd: string): Promise<ListWorkspaceFilesResult> {
		const runGit = (args: readonly string[]) =>
			localCommandService.run({
				args,
				command: 'git',
				cwd,
				maxOutputBytes: MAX_OUTPUT_BYTES,
				timeoutMs: TIMEOUT_MS,
			});

		const [tracked, ignored, deleted, typechanged] = await Promise.all([
			runGit(GIT_ARGS),
			runGit(GIT_IGNORED_ARGS),
			runGit(GIT_DELETED_ARGS),
			runGit(GIT_TYPECHANGED_ARGS),
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

		const trackedListing = parseGitLsFiles(
			tracked.stdout,
			bestEffortPaths(deleted),
			bestEffortPaths(typechanged),
		);
		// Ignored listing is best-effort: a failure there must never drop the
		// primary file list, so fall back to no ignored entries.
		const ignoredListing =
			ignored.status === 'success'
				? await expandIgnoredEntries({
						budget: MAX_ENTRIES - trackedListing.entries.length,
						oversizedRoots: oversizedIgnoredRoots,
						rootMaxEntries: ignoredRootMaxEntries,
						stdout: ignored.stdout,
						trackedPaths: new Set(
							trackedListing.entries.map((entry) => entry.path),
						),
						workspaceCwd: cwd,
					})
				: { entries: [], probePaths: new Set<string>() };
		return {
			files: await annotateSymlinkTargets(
				cwd,
				[...trackedListing.entries, ...ignoredListing.entries],
				new Set([...trackedListing.probePaths, ...ignoredListing.probePaths]),
			),
		};
	}

	return {
		invalidate(workspaceCwd) {
			const cwdResult = resolveWorkspaceCwd(workspaceCwd);
			listings.delete(cwdResult.ok ? cwdResult.cwd : workspaceCwd);
		},
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

			const { cwd } = cwdResult;
			const cached = listings.get(cwd);
			if (cached && Date.now() - cached.at < LISTING_CACHE_TTL_MS) {
				return cached.result;
			}

			const pending = listingsInFlight.get(cwd);
			if (pending) {
				return pending;
			}

			const flight = buildListing(cwd)
				.then((result) => {
					// A failure is a transient state of the workspace — mid-clone, a
					// worktree being replaced — not a fact about its tree, so it is
					// never what the next caller is served.
					if (!result.error) {
						listings.set(cwd, { at: Date.now(), result });
					}
					return result;
				})
				.finally(() => {
					listingsInFlight.delete(cwd);
				});
			listingsInFlight.set(cwd, flight);
			return flight;
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
				const readable = await resolvePreviewRead({
					absolutePath: target.absolutePath,
					displayPath: target.displayPath,
					requestPath: request.path,
					scope: target.scope,
					workspaceCwd: cwdResult.cwd,
				});
				if (!readable.needsBytes) {
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
				// Only a link the followed `stat` already called a directory reaches
				// here, so refusing every symlink at this point cannot mislabel a link
				// to a file — that one left as `not-directory` above.
				if ((await lstat(target.absolutePath)).isSymbolicLink()) {
					return {
						entries: [],
						error: {
							code: 'symlinked-directory',
							message: 'Selected path is a symlink to a directory.',
						},
						path: target.relativePath,
					};
				}
				if (await hasSymlinkedAncestor(cwdResult.cwd, target.relativePath)) {
					return {
						entries: [],
						error: {
							code: 'symlinked-directory',
							message:
								'Selected path reaches through a symlink to a directory.',
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
					entries.push(ignoredDirentEntry(childPath, dirent));
					if (entries.length >= MAX_ENTRIES) {
						break;
					}
				}
				return {
					entries: await annotateSymlinkTargets(
						cwdResult.cwd,
						entries,
						new Set<string>(),
					),
					path: target.relativePath,
				};
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

/**
 * Collects the paths in a `-z` git listing into a set, dropping blanks.
 * @param stdout - Raw NUL-separated stdout.
 * @returns Every non-empty path the listing named.
 */
function parseNulSeparatedPaths(stdout: string): ReadonlySet<string> {
	const paths = new Set<string>();
	for (const raw of stdout.split('\0')) {
		const trimmed = raw.trim();
		if (trimmed) {
			paths.add(trimmed);
		}
	}
	return paths;
}

/**
 * Reads an auxiliary `-z` path listing that only refines the primary one. Each
 * is best-effort by design: a failure there must never drop the file list, so it
 * degrades to naming no paths rather than propagating.
 * @param result - Outcome of the auxiliary git invocation.
 * @returns Every path the listing named, or none when the invocation failed.
 */
function bestEffortPaths(
	result: Pick<LocalCommandResult, 'status' | 'stdout'>,
): ReadonlySet<string> {
	return result.status === 'success'
		? parseNulSeparatedPaths(result.stdout)
		: new Set<string>();
}

/** Index mode `git ls-files --stage` reports for a symlink blob. */
const GIT_SYMLINK_MODE = '120000';
// `<mode> <object> <stage>\t<path>` — an indexed entry under `--stage`. An
// `--others` entry has no such prefix, and matching the prefix rather than the
// first tab keeps a path that itself contains a tab from being mistaken for one.
const GIT_STAGE_RECORD = /^(\d{6}) [0-9a-f]+ \d\t/;

/**
 * Reads one `git ls-files --stage -z` record, which carries an index mode for a
 * tracked entry and nothing but the path for an untracked one.
 * @param record - A single NUL-separated record of the stdout stream.
 * @returns The record's path, plus its index mode when git reported one.
 */
function parseLsFilesRecord(record: string): { mode?: string; path: string } {
	const staged = GIT_STAGE_RECORD.exec(record);
	return staged
		? { mode: staged[1], path: record.slice(staged[0].length).trim() }
		: { path: record.trim() };
}

/** The paths of one `ls-files` stream, split by how their link status is known. */
interface CollectedLsFilesPaths {
	/** Listed file paths, in stream order. */
	filePaths: string[];
	/** Paths an index mode proved to be symlinks. */
	linkPaths: Set<string>;
	/** Paths whose link status only an lstat can settle. */
	probePaths: Set<string>;
}

/**
 * Reports whether a listed record names nothing the tree should carry a row for:
 * a blank record, an index path whose worktree file is gone, or OS junk.
 * @param entryPath - Path the record named, empty when the record was blank.
 * @param deletedPaths - Index paths missing from the worktree.
 * @returns True when the record should be dropped rather than listed.
 */
function isUnlistableLsFilesPath(
	entryPath: string,
	deletedPaths: ReadonlySet<string>,
): boolean {
	return (
		!entryPath || deletedPaths.has(entryPath) || isHiddenEntryPath(entryPath)
	);
}

/**
 * Collects the file paths of a `git ls-files --stage -z` stream, routing each to
 * the index mode that settles its link status or to the probe set when no mode
 * can settle it.
 *
 * Three kinds of path cannot trust an index mode, and each would otherwise show
 * the wrong icon. An untracked `--others` entry carries no mode at all. A
 * typechanged entry's mode describes the type its worktree file no longer has.
 * An unmerged entry emits one record per stage, whose modes may disagree both
 * with each other and with what is on disk, so a repeat record demotes the path
 * rather than letting the first stage decide.
 * @param stdout - Raw NUL-separated `ls-files --stage` stdout.
 * @param deletedPaths - Index paths missing from the worktree, dropped outright.
 * @param typechangedPaths - Tracked paths whose worktree type left the index behind.
 * @returns The listed paths, the index-proven links, and the paths needing a probe.
 */
function collectLsFilesPaths(
	stdout: string,
	deletedPaths: ReadonlySet<string>,
	typechangedPaths: ReadonlySet<string>,
): CollectedLsFilesPaths {
	const filePaths: string[] = [];
	const seenFiles = new Set<string>();
	const linkPaths = new Set<string>();
	const probePaths = new Set<string>();
	for (const raw of stdout.split('\0')) {
		const { mode, path: entryPath } = parseLsFilesRecord(raw);
		if (isUnlistableLsFilesPath(entryPath, deletedPaths)) {
			continue;
		}
		if (seenFiles.has(entryPath)) {
			linkPaths.delete(entryPath);
			probePaths.add(entryPath);
			continue;
		}
		seenFiles.add(entryPath);
		filePaths.push(entryPath);
		if (mode === undefined || typechangedPaths.has(entryPath)) {
			probePaths.add(entryPath);
		} else if (mode === GIT_SYMLINK_MODE) {
			linkPaths.add(entryPath);
		}
		if (filePaths.length >= MAX_ENTRIES) {
			break;
		}
	}
	return { filePaths, linkPaths, probePaths };
}

/**
 * Parses `git ls-files --stage -z` output into directory rows followed by file
 * rows, marking a tracked symlink from its index mode and reporting the paths
 * whose link status only an lstat can settle.
 *
 * Index entries whose worktree file is gone are dropped before the directory
 * rows are collected, so a deleted or moved-away folder disappears entirely
 * rather than lingering as a row with no children. Applying the filter to the
 * whole listing is safe: the `--others` half is on disk by definition and can
 * never appear in `--deleted`.
 * @param stdout - Raw NUL-separated `ls-files --stage` stdout.
 * @param deletedPaths - Index paths missing from the worktree.
 * @param typechangedPaths - Tracked paths whose worktree type left the index behind.
 * @returns Directory rows followed by file rows, outermost directories first,
 *   and the paths still needing a symlink probe.
 */
function parseGitLsFiles(
	stdout: string,
	deletedPaths: ReadonlySet<string>,
	typechangedPaths: ReadonlySet<string>,
): { entries: readonly WorkspaceFileEntryWire[]; probePaths: Set<string> } {
	const { filePaths, linkPaths, probePaths } = collectLsFilesPaths(
		stdout,
		deletedPaths,
		typechangedPaths,
	);

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
		const entry: WorkspaceFileEntryWire = {
			kind: 'file',
			name: filePath.split('/').pop() ?? filePath,
			path: filePath,
		};
		entries.push(
			linkPaths.has(filePath)
				? { ...entry, symlinkTargetKind: 'unknown' }
				: entry,
		);
	}
	return { entries, probePaths };
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
 *
 * An expanded root's entries come from a directory read that already reports
 * link status, so only the individually-ignored files git named — which arrive
 * as bare paths — are reported back as needing a symlink probe.
 */
async function expandIgnoredEntries({
	budget,
	oversizedRoots,
	rootMaxEntries,
	stdout,
	trackedPaths,
	workspaceCwd,
}: {
	budget: number;
	oversizedRoots: Map<string, number>;
	rootMaxEntries: number;
	stdout: string;
	trackedPaths: ReadonlySet<string>;
	workspaceCwd: string;
}): Promise<{ entries: WorkspaceFileEntryWire[]; probePaths: Set<string> }> {
	const probePaths = new Set<string>();
	if (budget <= 0) {
		return { entries: [], probePaths };
	}
	const { files, roots } = parseIgnoredRoots(stdout);
	const entries: WorkspaceFileEntryWire[] = [];
	let remaining = budget;

	for (const file of files) {
		if (remaining <= 0) {
			return { entries, probePaths };
		}
		if (!trackedPaths.has(file.path)) {
			entries.push(file);
			probePaths.add(file.path);
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
		const rootMtimeMs = await directoryMtimeMs(workspaceCwd, root);
		if (rootMtimeMs !== null && oversizedRoots.get(root) === rootMtimeMs) {
			entries.push(ignoredEntry(root, 'directory'));
			remaining -= 1;
			continue;
		}
		const walked = await walkIgnoredRoot(
			workspaceCwd,
			root,
			Math.min(rootMaxEntries, remaining),
		);
		if (walked) {
			oversizedRoots.delete(root);
			entries.push(...walked);
			remaining -= walked.length;
		} else {
			// Too big to enumerate cheaply — leave it collapsed.
			if (rootMtimeMs !== null) {
				oversizedRoots.set(root, rootMtimeMs);
			}
			entries.push(ignoredEntry(root, 'directory'));
			remaining -= 1;
		}
	}

	return { entries, probePaths };
}

/**
 * Modification time of an ignored root, used to decide whether a remembered
 * over-the-cap verdict still holds.
 * @param workspaceCwd - Absolute workspace root.
 * @param root - Workspace-relative ignored directory.
 * @returns The directory's mtime in milliseconds, or null when it cannot be read.
 */
async function directoryMtimeMs(
	workspaceCwd: string,
	root: string,
): Promise<number | null> {
	return stat(path.join(workspaceCwd, root))
		.then((stats) => stats.mtimeMs)
		.catch(() => null);
}

/**
 * Builds an ignored tree row from a directory read, carrying over the link
 * status the read already reported so the tree never lstats it. A symlink stays
 * a leaf whatever it points at, which is what keeps the walk from following it.
 * @param entryPath - Workspace-relative path of the entry.
 * @param dirent - Directory entry the read produced for it.
 * @returns The ignored row, marked when the entry is a symlink.
 */
function ignoredDirentEntry(
	entryPath: string,
	dirent: Dirent,
): WorkspaceFileEntryWire {
	if (dirent.isSymbolicLink()) {
		return {
			...ignoredEntry(entryPath, 'file'),
			symlinkTargetKind: 'unknown',
		};
	}
	return ignoredEntry(entryPath, dirent.isDirectory() ? 'directory' : 'file');
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
			const child = ignoredDirentEntry(childPath, dirent);
			entries.push(child);
			if (entries.length > cap) {
				return null;
			}
			if (child.kind === 'directory') {
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
 * Decides whether a resolved path's bytes are worth reading, answering the whole
 * request itself when they are not. The stat, size, and symlink-containment
 * checks run in the order the security model requires (size cap before the
 * real-path check). Containment applies only to a `workspace`-scoped path: an
 * `external` one was already cleared to live outside the root, so re-checking it
 * would refuse every file it exists to allow.
 *
 * An oversize file the preview could never render anyway — a 40 MB TIFF, a phone
 * HEIC — is named rather than refused on size, since "too large to preview"
 * would promise that a smaller one would have worked.
 * @param params - Absolute path, the path to echo in errors, the original
 *   request path, the resolved scope, and the workspace root.
 * @returns The preview MIME type and size when the bytes are still needed, or
 *   the finished result when they are not.
 */
async function resolvePreviewRead(params: {
	absolutePath: string;
	displayPath: string;
	requestPath: string;
	scope: PreviewPathScope;
	workspaceCwd: string;
}): Promise<
	| { needsBytes: true; previewEmbedMimeType: string | null; sizeBytes: number }
	| { needsBytes: false; result: ReadWorkspaceFileResult }
> {
	const { absolutePath, displayPath, requestPath, scope, workspaceCwd } =
		params;
	const fileStat = await stat(absolutePath);
	if (!fileStat.isFile()) {
		return {
			needsBytes: false,
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
		const unrenderableImageMimeType = previewEmbedMimeType
			? null
			: imageMimeTypeForPath(displayPath);
		return {
			needsBytes: false,
			result: unrenderableImageMimeType
				? {
						binaryReason: 'unsupported-image',
						contentEncoding: 'binary',
						isExternal: scope === 'external',
						mimeType: unrenderableImageMimeType,
						path: displayPath,
						sizeBytes: fileStat.size,
					}
				: {
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
			needsBytes: false,
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
	return { needsBytes: true, previewEmbedMimeType, sizeBytes: fileStat.size };
}

/**
 * Builds the preview payload for a validated file: a base64 result when the
 * bytes match a browser-previewable type, utf8 source when they read as text,
 * and an empty `binary` result otherwise. That last case is what keeps a format
 * no engine decodes — a TIFF, a HEIC, an executable, a `.webp` whose bytes are
 * not really a WebP — from reaching the code surface as mojibake.
 * @param params - Decoded file buffer, its declared preview MIME type (or null),
 *   the path to echo back, whether that path is outside the workspace, and the
 *   on-disk size in bytes.
 * @returns A base64, utf8, or binary preview result.
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
	if (bytesLookLikeText(buffer)) {
		return {
			content: buffer.toString('utf8'),
			contentEncoding: 'utf8',
			isExternal,
			path: displayPath,
			sizeBytes,
		};
	}
	const imageMimeType = imageMimeTypeForPath(displayPath);
	return {
		binaryReason: binaryReasonFor(imageMimeType, previewEmbedMimeType),
		contentEncoding: 'binary',
		isExternal,
		mimeType: imageMimeType ?? undefined,
		path: displayPath,
		sizeBytes,
	};
}

/**
 * Names why a preview fell through to bytes it cannot render, along two axes:
 * whether the extension names an image or a document, and whether the preview
 * could have drawn that format at all. That separates "this .webp is not a
 * WebP" from "Ensemblr cannot show TIFFs", which are opposite things to do
 * something about, and keeps a PDF that is not a PDF from being called an image.
 * @param imageMimeType - The image type the extension declares, or null.
 * @param previewEmbedMimeType - The type the preview would have embedded, or
 *   null when the extension names nothing embeddable.
 * @returns The reason the renderer explains the empty preview with.
 */
function binaryReasonFor(
	imageMimeType: string | null,
	previewEmbedMimeType: string | null,
): ReadWorkspaceFileBinaryReason {
	if (imageMimeType) {
		return previewEmbedMimeType ? 'invalid-image' : 'unsupported-image';
	}
	return previewEmbedMimeType ? 'invalid-document' : 'not-text';
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
