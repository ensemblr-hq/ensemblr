export type WorkbenchMockChatToolIcon =
	| 'check'
	| 'circle-dashed'
	| 'file-code'
	| 'loader'
	| 'search'
	| 'terminal';

export interface WorkbenchMockChatTool {
	detail: string;
	icon: WorkbenchMockChatToolIcon;
	label: string;
	status: 'done' | 'pending' | 'running';
}

export interface WorkbenchMockChatMessage {
	author: string;
	body: string[];
	speaker: 'assistant' | 'user';
	status?: 'blocked' | 'working';
	time: string;
	tools?: WorkbenchMockChatTool[];
}
