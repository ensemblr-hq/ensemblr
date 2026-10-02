/** Icon name for a tool entry in mock workbench chat fixtures. */
export type WorkbenchMockChatToolIcon =
	| 'check'
	| 'circle-dashed'
	| 'file-code'
	| 'loader'
	| 'search'
	| 'terminal';

/** A tool invocation shown within a mock workbench chat message. */
export interface WorkbenchMockChatTool {
	detail: string;
	icon: WorkbenchMockChatToolIcon;
	label: string;
	status: 'done' | 'pending' | 'running';
}

/** A single message in a mock workbench chat thread fixture. */
export interface WorkbenchMockChatMessage {
	author: string;
	body: string[];
	speaker: 'assistant' | 'user';
	status?: 'blocked' | 'working';
	time: string;
	tools?: WorkbenchMockChatTool[];
}
