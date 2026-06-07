import { atom } from 'jotai';

/** Whether the GitHub clone dialog is currently mounted-open. */
export const cloneDialogOpenAtom = atom<boolean>(false);
