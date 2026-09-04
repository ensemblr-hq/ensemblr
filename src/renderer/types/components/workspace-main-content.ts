import type {
	SessionTabPlacement,
	WorkbenchShellProps,
} from '@/renderer/types/workbench-shell';

/** State and handlers passed from the workbench shell into the main content. */
export type WorkspaceMainContentState = Pick<
	WorkbenchShellProps,
	'activeWorkspace' | 'composer' | 'onSessionTabChange'
> & {
	activeSession: WorkbenchShellProps['activeSession'];
	closedSessions: WorkbenchShellProps['activeWorkspace']['sessions'];
	/** Selects All files and expands a workspace-relative directory. */
	onDirectoryReveal: (directoryPath: string) => void;
	onFilePreviewOpen: (input: {
		filePath: string;
	}) => Promise<{ chatTabId: string } | null>;
	/** Launches an agent harness in a new embedded-terminal tab. */
	onLaunchHarness: (input: {
		harnessId: string;
		harnessLabel: string;
	}) => Promise<{ chatTabId: string } | null>;
	/** Opens the workspace's architecture diagram tab. */
	onOpenArchitectureDiagram: () => Promise<{ chatTabId: string } | null>;
	onSessionTabClose: (sessionId: string) => void;
	/** Promotes an ephemeral preview tab to a permanent one. */
	onSessionTabPin: (sessionId: string) => void;
	/**
	 * Persists the tab strip order after drag-and-drop reordering, along with the
	 * tab the user dragged.
	 */
	onSessionTabsReorder: (
		sessionIds: string[],
		draggedSessionId: string,
	) => void;
	onTurnDiffOpen: (input: {
		label: string;
		turnId: string;
	}) => Promise<{ chatTabId: string } | null>;
	onSessionTabOpen: (options?: {
		placement?: SessionTabPlacement;
	}) => Promise<{ chatTabId: string } | null>;
	onSessionTabRestore: (sessionId: string) => void;
	sessionTabs: WorkbenchShellProps['activeWorkspace']['sessions'];
};
