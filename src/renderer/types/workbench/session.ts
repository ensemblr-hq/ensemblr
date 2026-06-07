export interface SessionTabModel {
	id: string;
	label: string;
	status: 'blocked' | 'idle' | 'working';
	summary: string;
	updatedLabel: string;
}

export interface ComposerShellState {
	disabled: boolean;
	disabledReason: string | null;
	modelLabel: string;
	placeholder: string;
	thinkingLabel: string;
}
