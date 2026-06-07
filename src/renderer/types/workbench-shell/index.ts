/**
 * UI-shell scaffolding types for the workbench: navigation targets and
 * state, shell props, active view, dock actions, health primitives, and
 * session tab state.
 *
 * For domain model types — projects, workspaces, sessions, dock tabs,
 * review, pull requests — see `types/workbench/`.
 */
export type {
	WorkbenchStaticNavigationTarget,
	WorkbenchWorkspaceNavigationLinkTarget,
} from './navigation';
export type {
	ChangesViewMode,
	WorkbenchDockActions,
	WorkbenchHealth,
} from './primitives';
export type {
	ProjectNavigationState,
	WorkspaceEntry,
} from './project-navigation';
export type { WorkbenchActiveView, WorkbenchShellProps } from './props';
export type { SessionTabState } from './session-tab-state';
