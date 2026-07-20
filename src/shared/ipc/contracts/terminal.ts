/**
 * Wire types for the workspace terminal surface: PTY-backed interactive
 * terminals plus script-output sessions rendered in the dock.
 */

/** What a terminal session hosts. */
export type TerminalSessionKind =
	| 'agent'
	| 'archive-script'
	| 'run-script'
	| 'setup-script'
	| 'terminal';

/** Renderer-facing lifecycle state of a terminal session. */
export type TerminalSessionStatus = 'exited' | 'failed' | 'running' | 'stopped';

/** Severity of a terminal diagnostic. */
export type TerminalDiagnosticSeverity = 'error' | 'info' | 'warning';

/** A diagnostic message about a terminal session or spawn attempt. */
export interface TerminalDiagnostic {
	code: string;
	message: string;
	severity: TerminalDiagnosticSeverity;
}

/** IPC-safe snapshot of one terminal session. */
export interface TerminalSessionSnapshot {
	cols: number;
	/** Command line shown in the UI; never includes secret values. */
	commandLabel: string;
	createdAt: string;
	endedAt: string | null;
	exitCode: number | null;
	id: string;
	kind: TerminalSessionKind;
	/**
	 * Local dev-server URL auto-detected from a `run-script` session's output
	 * (Vite `Local:` etc.), or `null` until one is seen. Powers the dock's Open
	 * button. Always `null` for non-run-script sessions.
	 */
	previewUrl: string | null;
	rows: number;
	status: TerminalSessionStatus;
	title: string;
	workspaceId: string;
}

/** Request to create a terminal session in a workspace. */
export interface CreateTerminalSessionRequest {
	cols?: number;
	/**
	 * Optional explicit command. When omitted an interactive login shell is
	 * spawned (for `kind: 'terminal'`).
	 */
	command?: string;
	kind?: TerminalSessionKind;
	rows?: number;
	title?: string;
	workspaceId: string;
}

/** Result of creating a terminal session: the new session, or diagnostics on failure. */
export interface CreateTerminalSessionResult {
	diagnostics: TerminalDiagnostic[];
	session: TerminalSessionSnapshot | null;
}

/** Request to write input data to a terminal session. */
export interface WriteTerminalRequest {
	data: string;
	terminalId: string;
}

/** Request to resize a terminal session's viewport. */
export interface ResizeTerminalRequest {
	cols: number;
	rows: number;
	terminalId: string;
}

/** Request to kill a terminal session. */
export interface KillTerminalRequest {
	terminalId: string;
}

/** Result of killing a terminal session, with the final session snapshot when available. */
export interface KillTerminalResult {
	diagnostics: TerminalDiagnostic[];
	session: TerminalSessionSnapshot | null;
}

/** Request to list a workspace's terminal sessions. */
export interface ListTerminalSessionsRequest {
	workspaceId: string;
}

/** The terminal sessions belonging to a workspace. */
export interface ListTerminalSessionsResult {
	sessions: TerminalSessionSnapshot[];
}

/** Request for a terminal session's replay snapshot. */
export interface TerminalSnapshotRequest {
	terminalId: string;
}

/** Replay payload used when a renderer (re)attaches to a live session. */
export interface TerminalSnapshotResult {
	/** Sequence number of the last output chunk folded into `scrollback`. */
	lastSeq: number;
	scrollback: string;
	session: TerminalSessionSnapshot | null;
}

/** Broadcast: PTY output chunk (main → renderer). */
export interface TerminalOutputBroadcast {
	data: string;
	/**
	 * Per-session monotonic chunk counter. Lets a (re)attaching renderer drop
	 * broadcasts already contained in the scrollback snapshot.
	 */
	seq: number;
	terminalId: string;
	workspaceId: string;
}

/** Broadcast: session lifecycle change (main → renderer). */
export interface TerminalLifecycleBroadcast {
	session: TerminalSessionSnapshot;
	terminalId: string;
	workspaceId: string;
}

/** Terminal slice of the `window.ensemblr` API. */
export interface TerminalApi {
	createTerminalSession: (
		request: CreateTerminalSessionRequest,
	) => Promise<CreateTerminalSessionResult>;
	killTerminalSession: (
		request: KillTerminalRequest,
	) => Promise<KillTerminalResult>;
	listTerminalSessions: (
		request: ListTerminalSessionsRequest,
	) => Promise<ListTerminalSessionsResult>;
	onTerminalLifecycle: (
		listener: (event: TerminalLifecycleBroadcast) => void,
	) => () => void;
	onTerminalOutput: (
		listener: (event: TerminalOutputBroadcast) => void,
	) => () => void;
	resizeTerminalSession: (request: ResizeTerminalRequest) => Promise<void>;
	terminalSnapshot: (
		request: TerminalSnapshotRequest,
	) => Promise<TerminalSnapshotResult>;
	writeTerminalSession: (request: WriteTerminalRequest) => Promise<void>;
}
