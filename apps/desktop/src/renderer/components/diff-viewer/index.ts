/**
 * Public surface for the diff-viewer feature: a single rich single-file diff
 * component, the shared display toggles a surface stacking several of them can
 * hoist into its own header, and the row budget that same surface spends across
 * its viewers. Import from `@/renderer/components/diff-viewer` outside this
 * folder; the comment shape it renders inline lives in `@/renderer/types/diff`.
 */
export { DiffDisplayToggles } from './diff-toolbar';
export { DiffViewer } from './diff-viewer';
export {
	countPatchesWithinRowBudget,
	MAX_RENDERED_TURN_DIFF_ROWS,
} from './hunk-budget';
