/**
 * Ports the agent-control service delegates to. Each port is a narrow interface
 * over an existing main-process service, so the service stays decoupled and
 * unit-testable; concrete adapters wire these to the real chat-tab, Pi session,
 * terminal, script, and harness services at composition time.
 */
import type {
	AgentControlConversationStatus,
	AgentControlModelList,
	AgentControlTabInfo,
	AgentControlTerminalInfo,
	AgentControlWorkspaceInfo,
	FocusPanelName,
	OpenTabVariant,
	StartTerminalKind,
} from '../../shared/agent-control.ts';
import type { PermissionMode } from '../../shared/permissions.ts';

/** Which agent species a control command originated from. */
export type AgentSpecies = 'pi' | 'harness';

/**
 * Identity of an agent being spawned, resolved into a control-env overlay. Pi
 * sessions pass their real per-session id and the spawning session's id so
 * lineage (depth, deadlock) guardrails work; harness/terminal launches pass a
 * workspace-scoped id with `species: 'harness'`.
 */
export interface AgentControlEnvIdentity {
	workspaceId: string;
	sessionId: string;
	parentSessionId?: string | null;
	species?: AgentSpecies;
}

/**
 * Resolves the agent-control env overlay (control-server URL + a freshly minted
 * per-session token) for a spawning agent. Registers the origin as a side
 * effect. Returns an empty object when the control layer is unavailable.
 */
export type AgentControlEnvResolver = (
	identity: AgentControlEnvIdentity,
) => Record<string, string>;

/**
 * Resolved, trusted identity of a control command's caller. Minted at agent
 * spawn and looked up from the injected token; never assembled from
 * agent-supplied fields. Drives scope, permission mode, and lineage guardrails.
 */
export interface AgentControlOrigin {
	token: string;
	sessionId: string;
	workspaceId: string;
	workspaceCwd: string;
	parentSessionId: string | null;
	depth: number;
	species: AgentSpecies;
}

/** Lists workspaces for the cross-workspace read ops. */
export interface WorkspacePort {
	listWorkspaces: () => Promise<readonly AgentControlWorkspaceInfo[]>;
}

/** Chat/terminal tab operations plus the reads needed to scope-check them. */
export interface TabPort {
	spawnChatTab: (input: {
		workspaceId: string;
		title?: string;
	}) => Promise<{ chatTabId: string }>;
	closeTab: (input: { chatTabId: string }) => Promise<void>;
	openNonChatTab: (input: {
		workspaceId: string;
		variant: OpenTabVariant;
		filePath?: string;
		turnId?: string;
		commentBody?: string;
		prNumber?: number;
	}) => Promise<{ chatTabId: string }>;
	listTabs: (input: {
		workspaceId: string;
	}) => Promise<readonly AgentControlTabInfo[]>;
	/** Owning workspace of a tab, or null when it does not exist. */
	resolveTabWorkspace: (chatTabId: string) => Promise<string | null>;
}

/** Pi conversation lifecycle plus its scope-check and read helpers. */
export interface ConversationPort {
	startConversation: (input: {
		workspaceId: string;
		workspaceCwd: string;
		chatTabId?: string;
		prompt: string;
		model?: string;
		thinkingLevel?: string;
		/**
		 * The spawning (master) agent's own model, used as a fallback when no valid
		 * `model` is requested so a Pi child inherits the master's model rather than
		 * a hallucinated one. Only Pi callers provide it.
		 */
		callerModel?: string;
		/** Caller session id, threaded into the child's spawn env for lineage. */
		parentSessionId: string;
	}) => Promise<{ chatTabId: string; piSessionId: string }>;
	/** Lists the available Pi models plus the default, for model selection. */
	listModels: () => Promise<AgentControlModelList>;
	sendFollowUp: (input: {
		piSessionId: string;
		prompt: string;
	}) => Promise<void>;
	/** Resolves once the session goes idle, or `'timeout'` after `timeoutMs`. */
	waitForIdle: (
		piSessionId: string,
		timeoutMs: number,
	) => Promise<'completed' | 'timeout'>;
	getStatus: (
		piSessionId: string,
	) => Promise<AgentControlConversationStatus | null>;
	getLastMessage: (piSessionId: string) => Promise<string | null>;
	/** Owning workspace of a Pi session, or null when it does not exist. */
	resolveConversationWorkspace: (piSessionId: string) => Promise<string | null>;
}

/** Dock terminal operations plus their scope-check and read helpers. */
export interface TerminalPort {
	startTerminal: (input: {
		workspaceId: string;
		workspaceCwd: string;
		kind: StartTerminalKind;
	}) => Promise<{ terminalId: string }>;
	stopTerminal: (input: {
		workspaceId: string;
		terminalId?: string;
		kind?: 'setup' | 'run';
	}) => Promise<void>;
	writeTerminal: (input: {
		terminalId: string;
		input: string;
	}) => Promise<void>;
	readOutput: (terminalId: string) => Promise<string | null>;
	listTerminals: (input: {
		workspaceId: string;
	}) => Promise<readonly AgentControlTerminalInfo[]>;
	/** Owning workspace of a terminal, or null when it does not exist. */
	resolveTerminalWorkspace: (terminalId: string) => Promise<string | null>;
}

/** Launches a third-party harness into a new terminal tab. */
export interface HarnessPort {
	launchHarness: (input: {
		workspaceId: string;
		harnessId: string;
		/** Caller session id, threaded into the child's spawn env for lineage. */
		parentSessionId: string;
	}) => Promise<{ chatTabId: string; terminalId: string }>;
}

/**
 * Brings a view to the foreground by broadcasting a focus request to the
 * renderer window showing the workspace. Focus is renderer state (active
 * tab/panel), so this is the only port that reaches back to the UI.
 */
export interface FocusPort {
	focusTab: (input: { workspaceId: string; chatTabId: string }) => void;
	focusDockTab: (input: { workspaceId: string; dock: string }) => void;
	focusPanel: (input: { workspaceId: string; panel: FocusPanelName }) => void;
}

/**
 * Resolves the active permission mode. The mode is a global app setting (the
 * same value the IPC permission gate reads), so it takes no workspace argument.
 */
export interface PermissionPort {
	getMode: () => PermissionMode;
}

/**
 * Surfaces a confirmation to the human when the mode requires approval. Returns
 * true when approved. Harnesses have no native confirm channel, so this drives
 * Ensemblr's own UI regardless of the caller's species.
 */
export interface ConfirmPort {
	confirm: (input: {
		origin: AgentControlOrigin;
		summary: string;
	}) => Promise<boolean>;
}

/** All collaborators the agent-control service composes. */
export interface AgentControlPorts {
	workspaces: WorkspacePort;
	tabs: TabPort;
	conversations: ConversationPort;
	terminals: TerminalPort;
	harnesses: HarnessPort;
	focus: FocusPort;
	permissions: PermissionPort;
	confirm: ConfirmPort;
}
