import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
	parseSetupState,
	type WorkspaceSetupState,
} from '../../shared/scripts/setup-state.ts';
import { resolveContextPath } from '../config/context-directory.ts';
import { ENSEMBLR_DIRECTORY } from '../config/repository-config.ts';

/**
 * Filename of the machine-local per-worktree setup marker, written inside the
 * worktree's `.context` directory. The `.local.` segment marks it as
 * machine-local state, kept out of the repository by the root-level
 * `.context/` gitignore rule.
 */
export const SETUP_STATE_FILENAME = 'setup.local.json';

/** Absolute path to a worktree's current setup marker under `.context`. */
function setupStatePath(worktreePath: string): string {
	return resolveContextPath(worktreePath, SETUP_STATE_FILENAME);
}

/**
 * Absolute path to the legacy `.ensemblr/setup.local.json` marker. Read as a
 * fallback so workspaces set up before the move to `.context` are not forced to
 * re-run setup on their first reopen.
 */
function legacySetupStatePath(worktreePath: string): string {
	return path.join(worktreePath, ENSEMBLR_DIRECTORY, SETUP_STATE_FILENAME);
}

/** Parses a setup marker at `markerPath`, or null when absent/unreadable/malformed. */
function readMarker(markerPath: string): WorkspaceSetupState | null {
	try {
		return parseSetupState(JSON.parse(readFileSync(markerPath, 'utf8')));
	} catch {
		return null;
	}
}

/**
 * Reads the persisted setup marker from a worktree's `.context` directory,
 * falling back to the legacy `.ensemblr` location when the new one is absent.
 * @param worktreePath - Absolute path to the workspace worktree root.
 * @returns The stored setup state, or null when absent, unreadable, or malformed.
 */
export function readSetupStateFile(
	worktreePath: string,
): WorkspaceSetupState | null {
	return (
		readMarker(setupStatePath(worktreePath)) ??
		readMarker(legacySetupStatePath(worktreePath))
	);
}

/**
 * Writes the setup marker into a worktree's `.context` directory. Best-effort: a
 * filesystem error only costs one redundant setup run on the next open, so it is
 * swallowed rather than surfaced.
 * @param worktreePath - Absolute path to the workspace worktree root.
 * @param state - Setup state to persist.
 */
export function writeSetupStateFile(
	worktreePath: string,
	state: WorkspaceSetupState,
): void {
	try {
		const markerPath = setupStatePath(worktreePath);
		mkdirSync(path.dirname(markerPath), { recursive: true });
		writeFileSync(markerPath, `${JSON.stringify(state, null, 2)}\n`);
	} catch {}
}
