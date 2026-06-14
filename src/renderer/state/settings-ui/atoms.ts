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
