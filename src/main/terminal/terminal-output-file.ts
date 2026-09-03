import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
	ensureContextPath,
	resolveContextPath,
} from '../config/context-directory.ts';

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

/** Absolute path to a session's persisted output log under `.context/terminals`. */
function terminalOutputPath(worktreePath: string, terminalId: string): string {
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
		writeFileSync(outputPath, text);
	} catch {}
}

/**
 * Writes a captured scrollback into a preserved archive context, under the same
 * `terminals/<id>.log` layout a live worktree uses, so anything reading an
 * archive finds terminal output where it would look for it in a workspace.
 *
 * Unlike {@link writeTerminalOutput} this reports its failure: the archive is
 * the last copy of a scrollback whose worktree is about to be removed, so a
 * failed write is worth a diagnostic rather than a silent gap.
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
		mkdirSync(path.dirname(outputPath), { recursive: true });
		writeFileSync(outputPath, capture.text);
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
	try {
		return readFileSync(terminalOutputPath(worktreePath, terminalId), 'utf8');
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
	try {
		rmSync(terminalOutputPath(worktreePath, terminalId), { force: true });
	} catch {}
}
