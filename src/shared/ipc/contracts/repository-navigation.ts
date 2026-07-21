import type {
	FocusViewBroadcast,
	TabsChangedBroadcast,
} from '../../agent-control.ts';

/** Open-ended metadata bag attached to a repository or workspace in the navigation tree. */
export interface RepositoryWorkspaceNavigationMetadata {
	[key: string]: unknown;
}

/**
 * Compact pull-request status a workspace sidebar row can render without the
 * full PR snapshot. `merged`/`closed` mirror the PR's GitHub state; the
 * remaining values collapse an OPEN PR's checks + mergeability into one signal.
 */
export type WorkspacePrPresentationStatus =
	| 'blocked'
	| 'checking'
	| 'closed'
	| 'merged'
	| 'open'
	| 'ready';

/** The compact PR presentation attached to a navigation workspace row. */
export interface WorkspacePrPresentation {
	number: number;
	status: WorkspacePrPresentationStatus;
}

/** A workspace entry in the repository/workspace navigation tree. */
export interface RepositoryWorkspaceNavigationWorkspace {
	archivedAt: string | null;
	baseBranch: string | null;
	branchName: string | null;
	createdAt: string;
	id: string;
	metadata: RepositoryWorkspaceNavigationMetadata;
	name: string;
	path: string;
	/**
	 * Compact PR status derived from the workspace's cached GitHub snapshot.
	 * Absent/null when no PR is cached (never fetched, or the branch has none).
	 * Lets the sidebar icon reflect real merge/checks state without the full
	 * snapshot.
	 */
	pullRequest?: WorkspacePrPresentation | null;
	repositoryId: string;
	slug: string;
	updatedAt: string;
}

/** A repository entry, with its child workspaces, in the navigation tree. */
export interface RepositoryWorkspaceNavigationRepository {
	createdAt: string;
	defaultBranch: string | null;
	id: string;
	metadata: RepositoryWorkspaceNavigationMetadata;
	name: string;
	path: string;
	slug: string;
	updatedAt: string;
	workspaces: RepositoryWorkspaceNavigationWorkspace[];
}

/** Full repository/workspace navigation tree snapshot. */
export interface RepositoryWorkspaceNavigationSnapshot {
	generatedAt: string;
	repositories: RepositoryWorkspaceNavigationRepository[];
}

/** Repository / workspace navigation tree IPC surface. */
export interface NavigationApi {
	repositoryWorkspaceNavigation: () => Promise<RepositoryWorkspaceNavigationSnapshot>;
}

/** Window/shell-level IPC surface (resize the BrowserWindow, etc). */
export interface ShellApi {
	/** Closes the BrowserWindow that issued the request. */
	closeWindow: () => Promise<void>;
	ensureWindowWidth: (minimumWidth: number) => Promise<void>;
	/**
	 * Subscribes to the application menu's "Close Tab" (⌘/Ctrl+W) request,
	 * broadcast to the focused window. Returns an unsubscribe function.
	 */
	onCloseActiveTabRequest: (listener: () => void) => () => void;
	/**
	 * Subscribes to agent-control focus requests (an agent asked to bring a tab,
	 * dock terminal, or review panel to the foreground). Returns an unsubscribe
	 * function. The renderer applies it only for the window showing the payload's
	 * workspace.
	 */
	onAgentControlFocusView: (
		listener: (payload: FocusViewBroadcast) => void,
	) => () => void;
	/**
	 * Subscribes to agent-control tab-set changes (an agent opened or closed a
	 * tab). Returns an unsubscribe function. The renderer refreshes its tab list
	 * only for the window showing the payload's workspace.
	 */
	onAgentControlTabsChanged: (
		listener: (payload: TabsChangedBroadcast) => void,
	) => () => void;
	/** Opens an http/https URL in the user's default browser. */
	openExternal: (url: string) => Promise<void>;
}
