import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

/** Persisted Jotai atom holding the open/closed state of the workbench sidebar. */
export const sidebarOpenAtom = atomWithStorage<boolean | null>(
	'sidebar_state',
	null,
);

/**
 * Whether the navigation sidebar is on screen right now — mounted *and*
 * expanded. Distinct from {@link sidebarOpenAtom}, which records the user's
 * preference and says nothing about the routes that render outside the
 * workbench shell and so have no sidebar at all.
 *
 * Written by the sidebar itself, and read by anything that would otherwise say
 * the same thing twice — or, worse, stay silent on the assumption that the
 * sidebar is speaking when nothing of it is visible. Not persisted: it
 * describes this frame, not this user.
 */
export const navigationSidebarVisibleAtom = atom(false);
