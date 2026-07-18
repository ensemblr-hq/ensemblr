import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	parseSetupState,
	type WorkspaceSetupState,
} from '../../shared/scripts/setup-state.ts';
import { ENSEMBLR_DIRECTORY } from '../config/repository-config.ts';

/**
 * Filename of the gitignored per-worktree setup marker, written inside
 * {@link ENSEMBLR_DIRECTORY}. The `.local.` segment marks it as machine-local
 * state that {@link LOCAL_MARKER_IGNORE} keeps out of the user's repository.
 */
export const SETUP_STATE_FILENAME = 'setup.local.json';

/** `.gitignore` inside `.ensemblr` that keeps local markers untracked. */
const ENSEMBLR_GITIGNORE_FILENAME = '.gitignore';
/** Pattern that ignores every `*.local.*` marker the app writes. */
const LOCAL_MARKER_IGNORE = '*.local.*';

/** Converts a filesystem directory path into a file URL with a trailing slash. */
function directoryUrl(directoryPath: string): URL {
	const directory = directoryPath.endsWith(sep)
		? directoryPath
		: `${directoryPath}${sep}`;

	return pathToFileURL(directory);
}

/** Absolute path to a worktree's `.ensemblr` directory. */
function setupStateDirectory(worktreePath: string): string {
	return fileURLToPath(
		new URL(`${ENSEMBLR_DIRECTORY}/`, directoryUrl(worktreePath)),
	);
}

/** Absolute path to a worktree's setup marker file. */
function setupStatePath(worktreePath: string): string {
	return fileURLToPath(
		new URL(
			SETUP_STATE_FILENAME,
			directoryUrl(setupStateDirectory(worktreePath)),
		),
	);
}

/**
 * Reads the persisted setup marker from a worktree's `.ensemblr` directory.
 * @param worktreePath - Absolute path to the workspace worktree root.
 * @returns The stored setup state, or null when absent, unreadable, or malformed.
 */
export function readSetupStateFile(
	worktreePath: string,
): WorkspaceSetupState | null {
	try {
		return parseSetupState(
			JSON.parse(readFileSync(setupStatePath(worktreePath), 'utf8')),
		);
	} catch {
		return null;
	}
}

/**
 * Writes the setup marker into a worktree's `.ensemblr` directory and ensures a
 * sibling `.gitignore` keeps `*.local.*` markers out of the user's repository.
 * Best-effort: a filesystem error only costs one redundant setup run on the next
 * open, so it is swallowed rather than surfaced.
 * @param worktreePath - Absolute path to the workspace worktree root.
 * @param state - Setup state to persist.
 */
export function writeSetupStateFile(
	worktreePath: string,
	state: WorkspaceSetupState,
): void {
	try {
		const directory = setupStateDirectory(worktreePath);
		mkdirSync(directory, { recursive: true });
		ensureLocalMarkerIgnored(directory);
		writeFileSync(
			fileURLToPath(new URL(SETUP_STATE_FILENAME, directoryUrl(directory))),
			`${JSON.stringify(state, null, 2)}\n`,
		);
	} catch {}
}

/**
 * Ensures `.ensemblr/.gitignore` excludes local markers, creating it when absent
 * and appending the pattern when a user-authored `.gitignore` lacks it.
 * @param directory - Absolute path to the worktree's `.ensemblr` directory.
 */
function ensureLocalMarkerIgnored(directory: string): void {
	const gitignorePath = fileURLToPath(
		new URL(ENSEMBLR_GITIGNORE_FILENAME, directoryUrl(directory)),
	);
	const existing = readGitignore(gitignorePath);

	if (existing?.split(/\r?\n/).includes(LOCAL_MARKER_IGNORE)) {
		return;
	}

	const prefix =
		existing && !existing.endsWith('\n') ? `${existing}\n` : (existing ?? '');
	writeFileSync(gitignorePath, `${prefix}${LOCAL_MARKER_IGNORE}\n`);
}

/** Reads an existing `.gitignore`, returning null when it is absent. */
function readGitignore(gitignorePath: string): string | null {
	try {
		return readFileSync(gitignorePath, 'utf8');
	} catch {
		return null;
	}
}
