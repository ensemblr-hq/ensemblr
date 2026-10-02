import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { load } from 'js-toml';

import type { SettingsPublicationFailureCode } from '../../shared/ipc/contracts/settings-publication.ts';
import { writeFileAtomicExclusive } from '../safe-fs/index.ts';
import { isPlainRecord } from './json-utils.ts';
import {
	ENSEMBLR_DIRECTORY,
	ENSEMBLR_SETTINGS_FILENAME,
} from './repository-paths.ts';
import {
	MAX_SETTINGS_BYTES,
	readBoundedSettingsFile,
	settingsPathRefusal,
} from './settings-file-access.ts';
import type {
	CapturedSettingsFile,
	SettingsGitFingerprint,
} from './settings-publication-recovery.ts';
import type { WorkspaceSettingsTarget } from './workspace-settings-target.ts';

const GIT_TIMEOUT_MS = 5_000;
const SETTINGS_RELATIVE_PATH = `${ENSEMBLR_DIRECTORY}/${ENSEMBLR_SETTINGS_FILENAME}`;
const UNSAFE_PATH_MESSAGE =
	'The settings path is missing, symlinked, or not a regular file.';
const GIT_UNAVAILABLE_MESSAGE =
	'Git could not inspect settings publication state.';

/** Error carrying the renderer-safe failure category for one guarded operation. */
export class SettingsPublicationError extends Error {
	readonly code: SettingsPublicationFailureCode;

	/** Creates a typed publication error. */
	constructor(code: SettingsPublicationFailureCode, message: string) {
		super(message);
		this.name = 'SettingsPublicationError';
		this.code = code;
	}
}

/** Ensures root and target are real worktrees backed by the same Git directory. */
export function validateRepositoryPair(target: WorkspaceSettingsTarget): void {
	validateSettingsPath(target.repositoryPath);
	validateSettingsPath(target.workspacePath);
	const rootTop = gitOutput(target.repositoryPath, [
		'rev-parse',
		'--show-toplevel',
	]);
	const workspaceTop = gitOutput(target.workspacePath, [
		'rev-parse',
		'--show-toplevel',
	]);
	if (
		realpathSync(rootTop) !== realpathSync(target.repositoryPath) ||
		realpathSync(workspaceTop) !== realpathSync(target.workspacePath)
	) {
		throw new SettingsPublicationError(
			'path-unsafe',
			'The selected settings target is not a worktree root.',
		);
	}
	const rootCommon = resolveGitPath(
		target.repositoryPath,
		gitOutput(target.repositoryPath, ['rev-parse', '--git-common-dir']),
	);
	const workspaceCommon = resolveGitPath(
		target.workspacePath,
		gitOutput(target.workspacePath, ['rev-parse', '--git-common-dir']),
	);
	if (realpathSync(rootCommon) !== realpathSync(workspaceCommon)) {
		throw new SettingsPublicationError(
			'target-not-found',
			'The selected workspace belongs to another Git repository.',
		);
	}
}

/**
 * Reports whether a resolved target is still the live worktree pair it was
 * recorded as, so a settings write never lands in a directory the workspace has
 * since moved away from or that belongs to another repository.
 * @param target - Target resolved from the stored workspace record.
 * @returns True when both checkouts validate as worktrees of one repository.
 */
export function isWritableWorkspaceTarget(
	target: WorkspaceSettingsTarget,
): boolean {
	try {
		validateRepositoryPair(target);
		return true;
	} catch {
		return false;
	}
}

/** Captures a worktree settings file with a bounded content hash. */
export function captureSettingsFile(
	repositoryPath: string,
	role: 'source' | 'target',
): CapturedSettingsFile {
	validateSettingsPath(repositoryPath);
	const filePath = settingsPath(repositoryPath);
	if (!existsSync(filePath)) {
		return captureBytes(null);
	}
	try {
		return captureBytes(readBoundedSettings(filePath));
	} catch {
		throw new SettingsPublicationError(
			role === 'source' ? 'source-unreadable' : 'target-unreadable',
			`${role === 'source' ? 'Root' : 'Workspace'} settings could not be read.`,
		);
	}
}

/** Reads the root HEAD settings blob, treating an absent path as an empty base. */
export function captureHeadSettings(
	repositoryPath: string,
): CapturedSettingsFile {
	const exists = runGit(repositoryPath, [
		'cat-file',
		'-e',
		`HEAD:${SETTINGS_RELATIVE_PATH}`,
	]);
	if (exists.status !== 0) {
		return captureBytes(null);
	}
	const shown = runGit(repositoryPath, [
		'show',
		`HEAD:${SETTINGS_RELATIVE_PATH}`,
	]);
	if (shown.status !== 0) {
		throw new SettingsPublicationError(
			'git-unavailable',
			'Root HEAD settings could not be read.',
		);
	}
	const bytes = Buffer.from(shown.stdout);
	ensureBounded(bytes);
	return captureBytes(bytes);
}

/** Runs `git merge-file -p --diff3` over app-owned temporary files. */
export function mergeSettingsFiles({
	base,
	destination,
	source,
}: {
	base: CapturedSettingsFile;
	destination: CapturedSettingsFile;
	source: CapturedSettingsFile;
}): { file: CapturedSettingsFile; status: 'clean' | 'conflict' } {
	const directory = mkdtempSync(path.join(tmpdir(), 'ensemblr-merge-file-'));
	try {
		const currentPath = path.join(directory, 'workspace');
		const basePath = path.join(directory, 'base');
		const sourcePath = path.join(directory, 'root');
		writeFileSync(currentPath, bytesOf(destination));
		writeFileSync(basePath, bytesOf(base));
		writeFileSync(sourcePath, bytesOf(source));
		const result = spawnSync(
			'git',
			[
				'merge-file',
				'-p',
				'--diff3',
				'-L',
				'workspace',
				'-L',
				'root HEAD',
				'-L',
				'root working copy',
				currentPath,
				basePath,
				sourcePath,
			],
			{
				encoding: 'buffer',
				maxBuffer: MAX_SETTINGS_BYTES,
				timeout: GIT_TIMEOUT_MS,
			},
		);
		if (result.error || result.status === null || result.status < 0) {
			throw new SettingsPublicationError(
				'merge-failed',
				'Git could not prepare the settings merge.',
			);
		}
		if (result.status > 127) {
			throw new SettingsPublicationError(
				'merge-failed',
				'Git could not prepare the settings merge.',
			);
		}
		const output = Buffer.from(result.stdout);
		ensureBounded(output);
		return {
			file: captureBytes(output),
			status: result.status === 0 ? 'clean' : 'conflict',
		};
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
}

/** Captures HEAD, the staged settings entry, path status, and content. */
export function fingerprintGit(
	repositoryPath: string,
	file: CapturedSettingsFile,
): SettingsGitFingerprint {
	return {
		fileHash: file.hash,
		head: gitOutput(repositoryPath, ['rev-parse', 'HEAD']),
		indexEntry: gitOutput(repositoryPath, [
			'ls-files',
			'--stage',
			'--',
			SETTINGS_RELATIVE_PATH,
		]),
		status: readGitStatus(repositoryPath),
	};
}

/**
 * Throws when a worktree changed after preview.
 * @param repositoryPath - Worktree to re-probe.
 * @param expected - Fingerprint captured when the preview was prepared.
 * @param role - Which side of the publication is being checked.
 */
export function assertFingerprint(
	repositoryPath: string,
	expected: SettingsGitFingerprint,
	role: 'destination' | 'source',
): void {
	const current = captureSettingsFile(
		repositoryPath,
		role === 'source' ? 'source' : 'target',
	);
	const actual = fingerprintGit(repositoryPath, current);
	if (
		actual.fileHash !== expected.fileHash ||
		actual.head !== expected.head ||
		actual.indexEntry !== expected.indexEntry ||
		actual.status !== expected.status
	) {
		throw new SettingsPublicationError(
			'preview-stale',
			`${role === 'source' ? 'Root' : 'Workspace'} settings or Git state changed after preview.`,
		);
	}
}

/**
 * Reads porcelain status for only the settings path. The leading index column
 * is blank for a worktree-only modification, so the output keeps its leading
 * whitespace and only the trailing newline is dropped.
 * @param repositoryPath - Worktree to read status in.
 * @returns The porcelain v1 line for the settings path, or an empty string.
 */
export function readGitStatus(repositoryPath: string): string {
	const result = runGit(repositoryPath, [
		'status',
		'--porcelain=v1',
		'--untracked-files=all',
		'--',
		SETTINGS_RELATIVE_PATH,
	]);
	if (result.status !== 0) {
		throw gitUnavailable();
	}
	return result.stdout.toString('utf8').replace(/\n+$/, '');
}

/**
 * Reports whether root cleanup could alter staged or conflicted work. Porcelain
 * v1 puts a non-space in the index column for every staged and every conflicted
 * state, and `?` there only for an untracked path, so that column decides alone.
 * @param status - Porcelain v1 status line for the settings path, or empty.
 * @returns True when restoring the worktree copy would strand index state.
 */
export function hasStagedOrConflictedSettings(status: string): boolean {
	const indexColumn = status.slice(0, 1);
	return indexColumn !== '' && indexColumn !== ' ' && indexColumn !== '?';
}

/** Atomically replaces or removes one validated settings file. */
export function writeCapturedSettings(
	repositoryPath: string,
	file: CapturedSettingsFile,
): void {
	validateSettingsPath(repositoryPath);
	const filePath = settingsPath(repositoryPath);
	if (!file.exists) {
		if (existsSync(filePath)) {
			unlinkSync(filePath);
		}
		return;
	}
	const bytes = bytesOf(file);
	ensureBounded(bytes);
	const directory = path.dirname(filePath);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	validateSettingsPath(repositoryPath);
	writeFileAtomicExclusive(filePath, bytes);
}

/**
 * Validates TOML while allowing deliberate file absence.
 * @param file - Captured settings bytes to parse.
 * @param code - Failure category naming which side failed to parse.
 */
export function validateToml(
	file: CapturedSettingsFile,
	code: 'source-invalid' | 'target-invalid',
): void {
	if (!file.exists) {
		return;
	}
	try {
		const parsed: unknown = load(decode(file));
		if (parsed !== undefined && parsed !== null && !isPlainRecord(parsed)) {
			throw new Error('Settings root must be a table.');
		}
	} catch {
		throw new SettingsPublicationError(
			code,
			`${code === 'source-invalid' ? 'Root' : 'Workspace'} settings are not valid TOML.`,
		);
	}
}

/** Captures bytes and their deterministic hash. */
function captureBytes(bytes: Buffer | null): CapturedSettingsFile {
	return {
		bytesBase64: bytes?.toString('base64') ?? null,
		exists: bytes !== null,
		hash: bytes === null ? 'missing' : hash(bytes),
	};
}

/** Decodes captured UTF-8 text for the bounded preview. */
export function decode(file: CapturedSettingsFile): string {
	return bytesOf(file).toString('utf8');
}

/** Compares captured presence and bytes by hash. */
export function sameCapturedFile(
	left: CapturedSettingsFile,
	right: CapturedSettingsFile,
): boolean {
	return left.exists === right.exists && left.hash === right.hash;
}

/** Rejects oversized settings before they cross IPC or enter recovery storage. */
function ensureBounded(bytes: Buffer): void {
	if (bytes.byteLength > MAX_SETTINGS_BYTES) {
		throw settingsTooLarge();
	}
}

/**
 * Reads a settings file through the shared size bound, raising the publication
 * surface's own failure when the file is too large to admit.
 * @param filePath - Settings file to read.
 * @returns The file's bytes, always within the publication limit.
 */
function readBoundedSettings(filePath: string): Buffer {
	const result = readBoundedSettingsFile(filePath);
	if (!result.ok) {
		throw result.reason === 'too-large'
			? settingsTooLarge()
			: new SettingsPublicationError(
					'source-unreadable',
					'Settings could not be read.',
				);
	}

	return result.bytes;
}

/** Builds the shared oversized-settings failure. */
function settingsTooLarge(): SettingsPublicationError {
	return new SettingsPublicationError(
		'source-unreadable',
		'Settings exceed the 1 MiB publication limit.',
	);
}

/**
 * Rejects symlinked roots, config directories, and settings files, raising the
 * publication surface's own failure for the shared refusal.
 * @param repositoryPath - Absolute repository root.
 */
function validateSettingsPath(repositoryPath: string): void {
	if (settingsPathRefusal(repositoryPath) !== null) {
		throw unsafeSettingsPath();
	}
}

/** Builds the shared unsafe-path failure. */
function unsafeSettingsPath(): SettingsPublicationError {
	return new SettingsPublicationError('path-unsafe', UNSAFE_PATH_MESSAGE);
}

/** Builds the shared Git-unavailable failure. */
function gitUnavailable(): SettingsPublicationError {
	return new SettingsPublicationError(
		'git-unavailable',
		GIT_UNAVAILABLE_MESSAGE,
	);
}

/** Decodes captured bytes, using an empty buffer for deliberate absence. */
function bytesOf(file: CapturedSettingsFile): Buffer {
	return file.bytesBase64 === null
		? Buffer.alloc(0)
		: Buffer.from(file.bytesBase64, 'base64');
}

/** Computes a SHA-256 fingerprint without exposing content. */
function hash(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** Resolves the settings file below one trusted worktree root. */
function settingsPath(repositoryPath: string): string {
	return path.join(
		repositoryPath,
		ENSEMBLR_DIRECTORY,
		ENSEMBLR_SETTINGS_FILENAME,
	);
}

/**
 * Runs one bounded read-only Git command. `--no-optional-locks` keeps a status
 * read from refreshing — and so rewriting — the user's index behind their back.
 * @param cwd - Worktree the command runs in.
 * @param args - Git subcommand and arguments.
 * @returns The command's exit status and captured streams.
 */
function runGit(
	cwd: string,
	args: string[],
): { status: number | null; stderr: Buffer; stdout: Buffer } {
	const result = spawnSync('git', ['--no-optional-locks', ...args], {
		cwd,
		encoding: 'buffer',
		maxBuffer: MAX_SETTINGS_BYTES + 64 * 1024,
		timeout: GIT_TIMEOUT_MS,
	});
	if (result.error) {
		throw gitUnavailable();
	}
	return {
		status: result.status,
		stderr: Buffer.from(result.stderr),
		stdout: Buffer.from(result.stdout),
	};
}

/** Runs a successful Git command and trims its UTF-8 output. */
function gitOutput(cwd: string, args: string[]): string {
	const result = runGit(cwd, args);
	if (result.status !== 0) {
		throw gitUnavailable();
	}
	return result.stdout.toString('utf8').trim();
}

/** Resolves paths Git may report relative to the worktree. */
function resolveGitPath(cwd: string, value: string): string {
	return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}
