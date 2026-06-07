import type { WorkbenchShellProps } from '@/renderer/types/workbench-shell';

export type WorkspaceMainContentState = Pick<
	WorkbenchShellProps,
	'activeWorkspace' | 'composer' | 'onSessionTabChange'
> & {
	activeSession: WorkbenchShellProps['activeSession'];
	closedSessions: WorkbenchShellProps['activeWorkspace']['sessions'];
	onSessionTabClose: (sessionId: string) => void;
	onSessionTabRestore: (sessionId: string) => void;
	sessionTabs: WorkbenchShellProps['activeWorkspace']['sessions'];
};
