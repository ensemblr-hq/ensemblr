import type { LucideIcon } from 'lucide-react';

/**
 * The destructive lifecycle runs a workspace can be in the middle of. Both take
 * the worktree apart, so both make the workspace a place nobody may be standing
 * and nobody may navigate to; only the wording on the row differs.
 *
 * Lives here rather than beside the atom that holds it because both
 * `src/renderer/state/workspace/` and `src/renderer/lib/workbench/` need it, and
 * a lib module reaching into state for a type would put an edge on the graph
 * that only exists to name a two-word union.
 */
export type WorkspaceLifecycleRun = 'archiving' | 'deleting';

export type WorkspaceSidebarStateKind =
	| 'branch'
	| 'pr-blocked'
	| 'pr-checking'
	| 'pr-merged'
	| 'pr-open'
	| 'pr-ready'
	| 'pr-working'
	| 'workspace-archiving'
	| 'workspace-blocked'
	| 'workspace-checking'
	| 'workspace-deleting'
	| 'workspace-working';

export interface WorkspaceSidebarState {
	className: string;
	icon: LucideIcon;
	isSpinning?: boolean;
	kind: WorkspaceSidebarStateKind;
}
