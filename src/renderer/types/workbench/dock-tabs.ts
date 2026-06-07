export type FixedDockTabId = 'run' | 'setup';
export type TerminalDockTabId = `terminal:${string}`;
export type DockTabId = FixedDockTabId | TerminalDockTabId;
export type DockTabStatus = 'idle' | 'ready' | 'running' | 'warning';

export interface SetupScriptDockTabModel {
	id: 'setup';
	kind: 'setup-script';
	label: string;
	status: DockTabStatus;
}

export interface RunScriptDockTabModel {
	id: 'run';
	kind: 'run-script';
	label: string;
	status: DockTabStatus;
}

export interface TerminalDockTabModel {
	id: TerminalDockTabId;
	isDefault?: boolean;
	kind: 'terminal';
	label: string;
	lines: string[];
	sessionId: string;
	status: DockTabStatus;
}

export type DockTabModel =
	| RunScriptDockTabModel
	| SetupScriptDockTabModel
	| TerminalDockTabModel;
