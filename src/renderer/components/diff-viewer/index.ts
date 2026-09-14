/**
 * Public surface for the diff-viewer feature: a single rich single-file diff
 * component, plus the shared display toggles a surface stacking several of them
 * can hoist into its own header. Import from
 * `@/renderer/components/diff-viewer` outside this folder; the comment shape it
 * renders inline lives in `@/renderer/types/diff`.
 */
export { DiffDisplayToggles } from './diff-toolbar';
export { DiffViewer } from './diff-viewer';
