import { atom } from 'jotai';

/** Whether the GitHub clone dialog is currently mounted-open. */
export const cloneDialogOpenAtom = atom<boolean>(false);

/** Whether the quick-start dialog is currently mounted-open. */
export const quickStartDialogOpenAtom = atom<boolean>(false);
