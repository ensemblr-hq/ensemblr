/**
 * Public surface of the in-app updater's renderer state: the snapshot main
 * pushes, the actions the menu and Settings drive it with, the root-level sync
 * that keeps the two in step, and the classifier both the sidebar panel and the
 * menu-driven check read to decide which of them speaks.
 */
export { updateStatusAtom } from './atoms';
export { useUpdateActions, useUpdateStatus } from './hooks';
export type { UpdatePanelKind } from './update-panel-kind';
export { resolveUpdatePanelKind } from './update-panel-kind';
export type { UpdateActions } from './use-update-sync';
export { useUpdateSync } from './use-update-sync';
