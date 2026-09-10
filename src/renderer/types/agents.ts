import type { ComposerContextUsage } from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';

/** Runtime state reported for an agent conversation. */
export type AgentConversationStatus = 'blocked' | 'idle' | 'working';

/** Indicates whether context usage is live or the final persisted reading. */
export type AgentContextReading = 'last-recorded' | 'live';

/** Context-window usage presented in an agent row. */
export interface AgentContextUsage extends ComposerContextUsage {
	reading: AgentContextReading;
}

/** Prepared summary of the tool activity currently running in a conversation. */
export interface AgentConversationActivity {
	/** Total unresolved tool calls represented by this preview. */
	parallelCount?: number;
	target?: string | null;
	title: string;
}

/** Presentation state of a closed conversation's restoration attempt. */
export type AgentRestoreState = 'error' | 'idle' | 'pending';

/** Renderer-ready conversation shown in the workspace Agents panel. */
export interface AgentConversation {
	activity?: AgentConversationActivity | null;
	chatTabId: string;
	contextUsage: AgentContextUsage | null;
	depth: 0 | 1 | 2;
	isClosed: boolean;
	model: string | null;
	parentChatTabId: string | null;
	restoreState?: AgentRestoreState;
	runtime?: AgentProviderId | null;
	status: AgentConversationStatus;
	title: string;
}

/** Loading state for the prop-driven Agents panel. */
export type AgentsPanelState = 'error' | 'loading' | 'ready';

/** Public presentation inputs and navigation callbacks for the Agents panel. */
export interface AgentsPanelProps {
	conversations: readonly AgentConversation[];
	onRestore: (chatTabId: string) => void;
	onRetry?: () => void;
	onSelect: (chatTabId: string) => void;
	selectedChatTabId?: string | null;
	state?: AgentsPanelState;
}
