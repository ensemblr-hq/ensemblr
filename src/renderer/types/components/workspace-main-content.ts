import type { WorkbenchShellProps } from '@/renderer/types/workbench-shell';

export type WorkspaceMainContentState = Pick<
	WorkbenchShellProps,
	'activeWorkspace' | 'composer' | 'onSessionTabChange'
> & {
	activeSession: WorkbenchShellProps['activeSession'];
	closedSessions: WorkbenchShellProps['activeWorkspace']['sessions'];
	onFilePreviewOpen: (input: {
		filePath: string;
	}) => Promise<{ chatTabId: string } | null>;
	onSessionTabClose: (sessionId: string) => void;
	onTurnDiffOpen: (input: {
		label: string;
		turnId: string;
	}) => Promise<{ chatTabId: string } | null>;
	onSessionTabOpen: () => Promise<{ chatTabId: string } | null>;
	onSessionTabRestore: (sessionId: string) => void;
	sessionTabs: WorkbenchShellProps['activeWorkspace']['sessions'];
};
