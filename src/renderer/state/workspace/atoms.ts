import { atom } from 'jotai';

export const orderedProjectIdsAtom = atom<string[]>([]);

export const collapsedProjectIdsAtom = atom<string[]>([]);

export const pinnedWorkspaceIdsAtom = atom<string[]>([]);

export const closedSessionIdsByWorkspaceAtom = atom<Record<string, string[]>>(
	{},
);
