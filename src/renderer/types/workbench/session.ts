export interface SessionTabModel {
	id: string;
	label: string;
	status: 'blocked' | 'idle' | 'working';
	summary: string;
	updatedLabel: string;
}

export interface ComposerModelOption {
	displayName: string;
	id: string;
}

export interface ComposerThinkingOption {
	id: string;
	label: string;
}

export interface ComposerShellState {
	availableModels: readonly ComposerModelOption[];
	availableThinkingLevels: readonly ComposerThinkingOption[];
	disabled: boolean;
	disabledReason: string | null;
	isStreaming: boolean;
	modelId: string | null;
	modelLabel: string;
	onModelChange: (modelId: string) => void;
	onStop: () => Promise<void> | void;
	onSubmit: (prompt: string) => Promise<void> | void;
	onThinkingChange: (thinkingLevel: string) => void;
	placeholder: string;
	thinkingLabel: string;
	thinkingLevel: string | null;
}
