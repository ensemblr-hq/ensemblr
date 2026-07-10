/**
 * Wire types for the workspace terminal surface: PTY-backed interactive
 * terminals plus script-output sessions rendered in the dock.
 */

/** What a terminal session hosts. */
export type TerminalSessionKind =
	| 'archive-script'
	| 'run-script'
	| 'setup-script'
	| 'terminal';

/** Renderer-facing lifecycle state of a terminal session. */
export type TerminalSessionStatus = 'exited' | 'failed' | 'running' | 'stopped';

export type TerminalDiagnosticSeverity = 'error' | 'info' | 'warning';

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

export interface CreateTerminalSessionResult {
	diagnostics: TerminalDiagnostic[];
	session: TerminalSessionSnapshot | null;
}

export interface WriteTerminalRequest {
	data: string;
	terminalId: string;
}

export interface ResizeTerminalRequest {
	cols: number;
	rows: number;
	terminalId: string;
}

export interface KillTerminalRequest {
	terminalId: string;
}

export interface KillTerminalResult {
	diagnostics: TerminalDiagnostic[];
	session: TerminalSessionSnapshot | null;
}

export interface ListTerminalSessionsRequest {
	workspaceId: string;
}

export interface ListTerminalSessionsResult {
	sessions: TerminalSessionSnapshot[];
}

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
