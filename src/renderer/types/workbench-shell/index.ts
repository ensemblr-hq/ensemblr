/**
 * UI-shell scaffolding types for the workbench: navigation targets and
 * state, shell props, active view, dock actions, health primitives,
 * dashboard board cards and drops, and session tab state.
 *
 * For domain model types — projects, workspaces, sessions, dock tabs,
 * review, pull requests — see `types/workbench/`.
 */
export type { BoardCard, BoardDrop } from './dashboard';
export type { WorkbenchLayoutModel } from './layout';
export type {
	ChangesSource,
	ChangesViewMode,
	LifecycleSummaryRow,
	SessionTabActions,
	SessionTabPlacement,
	WorkbenchDockActions,
	WorkbenchHealth,
} from './primitives';
export type {
	ProjectNavigationState,
	WorkspaceEntry,
} from './project-navigation';
export type {
	SessionTabState,
	WorkbenchActiveView,
	WorkbenchShellProps,
	WorkbenchStaticNavigationTarget,
	WorkbenchWorkspaceNavigationLinkTarget,
} from './props';
