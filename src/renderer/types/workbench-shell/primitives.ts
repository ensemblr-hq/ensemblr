export interface WorkbenchHealth {
	detail: string;
	label: string;
	state: 'online' | 'pending' | 'unavailable';
}

export interface WorkbenchDockActions {
	onNewTerminal: () => void;
	onOpenRunPort: (port: number) => void;
	onOpenSetupScripts: () => void;
	onRunScript: () => void;
	onRunSetupScript: () => void;
	onStopRunScript: () => void;
}

export type ChangesViewMode = 'folders' | 'list';
