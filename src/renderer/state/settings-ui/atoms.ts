import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

/**
 * Settings UI state — not a user preference. The router URL (`$repoId`) is the
 * source of truth when on a repo route; this atom only remembers the
 * last-visited repo so the sidebar can default the repo scope when the user
 * jumps in from a non-repo route. Stale ids are tolerated: callers must
 * validate against the live project list before navigating.
 */
export const settingsActiveRepoIdAtom = atomWithStorage<string | null>(
	'ensemble_settings_ui_active_repo_id',
	null,
);

/**
 * In-app href to return to when Settings is closed (← Back or ⌘/Ctrl+W).
 * Recorded on navigation into `/settings` from a non-settings screen; `null`
 * means fall back to the workbench root. Deliberately plain in-memory (not
 * `atomWithStorage`): a return target is navigation-scoped, so a cold start
 * into Settings must not replay a stale screen from a previous app session.
 */
export const settingsReturnToAtom = atom<string | null>(null);
