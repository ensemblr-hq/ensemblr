export interface WorkbenchHealth {
	detail: string;
	label: string;
	state: 'online' | 'pending' | 'unavailable';
}

export interface WorkbenchDockActions {
	onCloseTerminal: (terminalId: string) => void;
	onNewTerminal: () => void;
	onOpenRunPort: (port: number) => void;
	onOpenSetupScripts: () => void;
	onRunScript: () => void;
	onRunSetupScript: () => void;
	onStopRunScript: () => void;
	onStopSetupScript: () => void;
}

export type ChangesViewMode = 'folders' | 'list';

/**
 * Extended session-tab state surface — adds async open/close handlers used by
 * the conversation-panel SessionTabs to drive routing on mutation success.
 */
export interface SessionTabActions {
	openSessionTab: () => Promise<{ chatTabId: string } | null>;
	openFilePreviewTab: (input: {
		filePath: string;
	}) => Promise<{ chatTabId: string } | null>;
	openTurnDiffTab: (input: {
		label: string;
		turnId: string;
	}) => Promise<{ chatTabId: string } | null>;
	closeSessionTabAsync: (
		chatTabId: string,
	) => Promise<{ replacementChatTabId: string | null }>;
}
