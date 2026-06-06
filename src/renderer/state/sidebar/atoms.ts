import { atomWithStorage } from 'jotai/utils';

export const sidebarOpenAtom = atomWithStorage<boolean | null>(
	'sidebar_state',
	null,
);
