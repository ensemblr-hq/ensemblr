import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { resolveContextPath } from '../config/context-directory.ts';

/**
 * Subdirectory under a worktree's `.context` that holds per-session terminal
 * output logs. Root-gitignored with the rest of `.context`, so raw scrollback
 * (which may echo secrets) never enters the user's repository.
 */
const TERMINAL_OUTPUT_SUBDIR = 'terminals';

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
 * blank restored tab, never correctness.
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
		const outputPath = terminalOutputPath(worktreePath, terminalId);
		mkdirSync(path.dirname(outputPath), { recursive: true });
		writeFileSync(outputPath, text);
	} catch {}
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
