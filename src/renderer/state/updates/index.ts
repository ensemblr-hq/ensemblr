/**
 * Public surface of the in-app updater's renderer state: the snapshot main
 * pushes, the actions the menu and Settings drive it with, and the root-level
 * sync that keeps the two in step.
 */
export { updateStatusAtom } from './atoms';
export { useUpdateActions, useUpdateStatus } from './hooks';
export type { UpdateActions } from './use-update-sync';
export { useUpdateSync } from './use-update-sync';
