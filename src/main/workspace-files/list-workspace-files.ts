import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ListWorkspaceFilesRequest, ListWorkspaceFilesResult, ReadWorkspaceFileRequest, ReadWorkspaceFileResult, WorkspaceFileEntryWire } from '../../shared/ipc/contracts/workspace-files';
import type { LocalCommandService } from '../commands/local-command';

const GIT_ARGS = [
	'ls-files',
	'--cached',
	'--others',
	'--exclude-standard',
	'-z',
] as const;
const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const MAX_READ_BYTES = 512 * 1024;

export interface ListWorkspaceFilesService {
	list: (
		request: ListWorkspaceFilesRequest,
	) => Promise<ListWorkspaceFilesResult>;
	read: (request: ReadWorkspaceFileRequest) => Promise<ReadWorkspaceFileResult>;
}

export interface CreateListWorkspaceFilesServiceOptions {
	localCommandService: LocalCommandService;
}

/**
 * Service that enumerates files tracked or untracked-but-not-ignored in a
 * workspace by shelling out to `git ls-files -z`, and safely reads selected
 * files for composer attachments. Caller-supplied cwd must be absolute.
 */
export function createListWorkspaceFilesService({
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

			const result = await localCommandService.run({
				args: GIT_ARGS,
				command: 'git',
				cwd: cwdResult.cwd,
				maxOutputBytes: MAX_OUTPUT_BYTES,
				timeoutMs: TIMEOUT_MS,
			});

			if (result.status !== 'success') {
				const message =
					result.failure?.message ?? 'git ls-files failed in workspace.';
				const stderr = result.stderr?.toLowerCase() ?? '';
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

			const files = parseGitLsFiles(result.stdout);
			return { files };
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
	};
}

/** Parses `git ls-files -z` output into directory rows followed by file rows. */
function parseGitLsFiles(stdout: string): readonly WorkspaceFileEntryWire[] {
	const filePaths: string[] = [];
	const seenFiles = new Set<string>();
	for (const raw of stdout.split('\0')) {
		const trimmed = raw.trim();
		if (!trimmed || seenFiles.has(trimmed)) {
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

/** Checks unknown thrown values for a Node-style error code. */
function hasErrorCode(cause: unknown, code: string): boolean {
	return (
		typeof cause === 'object' &&
		cause !== null &&
		'code' in cause &&
		cause.code === code
	);
}
