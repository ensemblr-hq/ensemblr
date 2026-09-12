import { constants, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

import {
	ensureContextPath,
	resolveContextPath,
} from '../config/context-directory.ts';
import { writeFileAtomicExclusive } from '../safe-fs/index.ts';

/**
 * Subdirectory under a worktree's `.context` that holds per-session terminal
 * output logs. Root-gitignored with the rest of `.context`, so raw scrollback
 * (which may echo secrets) never enters the user's repository.
 */
const TERMINAL_OUTPUT_SUBDIR = 'terminals';

/**
 * One terminal session's scrollback, carried by value rather than read from its
 * `.context` log, so it survives a worktree that is about to be removed.
 */
export interface TerminalScrollbackCapture {
	id: string;
	/** Raw scrollback bytes, ANSI included, exactly as the log would hold them. */
	text: string;
	title: string;
}

/** File extension for a persisted terminal output log. */
const TERMINAL_OUTPUT_EXTENSION = '.log';

/**
 * Owner-only mode for the directory holding raw scrollback. The logs are
 * unredacted by design — they are what the user saw — so a terminal that echoed
 * a credential leaves it here, and no other local user has business reading it.
 */
const TERMINAL_OUTPUT_DIRECTORY_MODE = 0o700;

/**
 * Absolute path to a session's persisted output log under `.context/terminals`.
 *
 * Session ids are generated, but `restoredFromId` arrives from the renderer as
 * an opaque string and reaches the delete path, so the refusal belongs here
 * rather than at each of the three callers that share this builder.
 * @param worktreePath - Absolute path to the workspace worktree root.
 * @param terminalId - Id of the terminal session whose log to address.
 * @returns The absolute log path, or null when the id is not a usable filename.
 */
function terminalOutputPath(
	worktreePath: string,
	terminalId: string,
): string | null {
	return resolveContextPath(
		worktreePath,
		TERMINAL_OUTPUT_SUBDIR,
		`${terminalId}${TERMINAL_OUTPUT_EXTENSION}`,
	);
}

/**
 * Persists a terminal session's scrollback so a later app run can replay it.
 * Best-effort: swallows filesystem errors since a missed write only costs a
 * blank restored tab, never correctness. A worktree that is no longer on disk
 * is skipped rather than recreated — see {@link ensureContextPath}.
 * @param worktreePath - Absolute path to the workspace worktree root.
 * @param terminalId - Id of the terminal session whose output to persist.
 * @param text - Raw scrollback bytes (ANSI included) to write.
 */
export function writeTerminalOutput(
	worktreePath: string,
	terminalId: string,
	text: string,
): void {
	try {
		const outputPath = ensureContextPath(
			worktreePath,
			TERMINAL_OUTPUT_SUBDIR,
			`${terminalId}${TERMINAL_OUTPUT_EXTENSION}`,
		);
		if (outputPath === null) {
			return;
		}
		writeFileAtomicExclusive(outputPath, text);
	} catch {}
}

/**
 * Open flags for a delta append: write-only, positioned at end, never creating
 * and never traversing a final symlink. `O_NOFOLLOW` is what keeps this as safe
 * as the staged-rename write it complements — a repository that committed a
 * link at the log's path gets `ELOOP` rather than a write through it.
 */
const APPEND_OPEN_FLAGS =
	constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW;

/**
 * Appends newly produced scrollback to a session's existing output log without
 * rewriting the whole buffer, and without blocking the event loop.
 *
 * This is the steady-state flush: a busy terminal produces a few kilobytes a
 * second against a buffer that may hold 200 MB, so rewriting the buffer every
 * second is what made the flush cost scale with the user's scrollback setting
 * rather than with the output. The caller keeps the log honest by rewriting it
 * whole through {@link writeTerminalOutput} whenever the in-memory ring has
 * trimmed past what the file already holds.
 * @param worktreePath - Absolute path to the workspace worktree root.
 * @param terminalId - Id of the terminal session whose log to extend.
 * @param text - Scrollback produced since the last flush.
 * @returns True when the append landed; false when the caller must rewrite.
 */
export async function appendTerminalOutput(
	worktreePath: string,
	terminalId: string,
	text: string,
): Promise<boolean> {
	const outputPath = terminalOutputPath(worktreePath, terminalId);
	if (outputPath === null) {
		return false;
	}

	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(outputPath, APPEND_OPEN_FLAGS);
		await handle.writeFile(text, 'utf8');
		return true;
	} catch {
		return false;
	} finally {
		await handle?.close().catch(() => {});
	}
}

/**
 * Writes a captured scrollback into a preserved archive context, under the same
 * `terminals/<id>.log` layout a live worktree uses, so anything reading an
 * archive finds terminal output where it would look for it in a workspace.
 *
 * Unlike {@link writeTerminalOutput} this reports its failure: the archive is
 * the last copy of a scrollback whose worktree is about to be removed, so a
 * failed write is worth a diagnostic rather than a silent gap.
 *
 * Written through {@link writeFileAtomicExclusive} for the mode it stages with
 * (`0600`) as much as for the exclusive create, since the bytes are raw
 * scrollback.
 * @param contextDirectory - Absolute path of the archived `.context` directory.
 * @param capture - Session id and raw scrollback bytes to write.
 * @returns The failure message, or null when the write landed.
 */
export function writeArchivedTerminalOutput(
	contextDirectory: string,
	capture: TerminalScrollbackCapture,
): string | null {
	// Session ids are generated, so this only fires on a caller that invented one
	// — but the id is joined straight into a path, and a `..` in it would write
	// outside the archive it was handed.
	if (path.basename(capture.id) !== capture.id) {
		return `"${capture.id}" is not a usable terminal session id.`;
	}

	const outputPath = path.join(
		contextDirectory,
		TERMINAL_OUTPUT_SUBDIR,
		`${capture.id}${TERMINAL_OUTPUT_EXTENSION}`,
	);

	try {
		mkdirSync(path.dirname(outputPath), {
			mode: TERMINAL_OUTPUT_DIRECTORY_MODE,
			recursive: true,
		});
		writeFileAtomicExclusive(outputPath, capture.text);
		return null;
	} catch (error) {
		return error instanceof Error
			? error.message
			: `Failed to write ${outputPath}.`;
	}
}

/**
 * Reads a terminal session's persisted scrollback.
 * @param worktreePath - Absolute path to the workspace worktree root.
 * @param terminalId - Id of the terminal session whose output to read.
 * @returns The stored output, or null when absent or unreadable.
 */
export function readTerminalOutput(
	worktreePath: string,
	terminalId: string,
): string | null {
	const outputPath = terminalOutputPath(worktreePath, terminalId);
	if (outputPath === null) {
		return null;
	}

	try {
		return readFileSync(outputPath, 'utf8');
	} catch {
		return null;
	}
}

/**
 * Deletes a terminal session's persisted output log. Best-effort: a missing file
 * is not an error, and any other failure is swallowed since stale logs are inert.
 * @param worktreePath - Absolute path to the workspace worktree root.
 * @param terminalId - Id of the terminal session whose output to delete.
 */
export function deleteTerminalOutput(
	worktreePath: string,
	terminalId: string,
): void {
	const outputPath = terminalOutputPath(worktreePath, terminalId);
	if (outputPath === null) {
		return;
	}

	try {
		rmSync(outputPath, { force: true });
	} catch {}
}
