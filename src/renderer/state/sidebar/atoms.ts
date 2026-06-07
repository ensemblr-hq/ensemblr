import { atomWithStorage } from 'jotai/utils';

/** Persisted Jotai atom holding the open/closed state of the workbench sidebar. */
export const sidebarOpenAtom = atomWithStorage<boolean | null>(
	'sidebar_state',
	null,
);
