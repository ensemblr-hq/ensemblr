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
	/**
	 * The session this diagnostic is about, when it is about one that already
	 * exists — the script holding the workspace when a second start is refused.
	 * A caller that cannot see the dock has no other way to reach it.
	 */
	terminalId?: string;
}

/** IPC-safe snapshot of one terminal session. */
export interface TerminalSessionSnapshot {
	/**
	 * Whether a spinner-less agent harness (Vibe) is mid-turn, derived from its
	 * on-disk session log. Always `false` for non-agent sessions and for harnesses
	 * whose busy state comes from the OSC spinner (Codex, Claude); the renderer ORs
	 * this with the spinner heuristic so either source can light the tab.
	 */
	agentBusy: boolean;
	/**
	 * Native session id an agent harness records for the running conversation,
	 * read from its on-disk session log (Claude transcript, Codex rollout, Vibe
	 * session). `null` for non-agent sessions and before the first successful read.
	 * Persisted onto the tab when it closes so a restored terminal tab can reattach
	 * the exact conversation via the harness's `--resume <id>` command. This is the
	 * harness CLI's own id, never an Ensemblr agent session id.
	 */
	harnessSessionId: string | null;
	/**
	 * Conversation title read from an agent harness's on-disk session log, for
	 * harnesses whose OSC window title is not the conversation title (Codex, Vibe).
	 * `null` for non-agent sessions, harnesses that title via OSC, and before the
	 * first successful read. When set, the renderer prefers it over the OSC title
	 * for the tab label; the busy indicator still reads {@link title}.
	 */
	agentTitle: string | null;
	/**
	 * Untruncated form of {@link agentTitle}, for tooltips. `agentTitle` is capped
	 * for tab display; this is null under exactly the same conditions.
	 */
	agentFullTitle: string | null;
	cols: number;
	/** Command line shown in the UI; never includes secret values. */
	commandLabel: string;
	createdAt: string;
	endedAt: string | null;
	exitCode: number | null;
	/**
	 * Name of the command currently running in the foreground of an interactive
	 * terminal, read from the PTY's foreground process group — `null` whenever the
	 * shell itself is in the foreground (nothing is running) and for every session
	 * kind but `terminal`. The dock shows it in place of the tab's own label while
	 * it is set, so a tab reads `npm` while a build runs and reverts afterwards.
	 */
	foregroundCommand: string | null;
	id: string;
	kind: TerminalSessionKind;
	/**
	 * Local dev-server URL auto-detected from a `run-script` session's output
	 * (Vite `Local:` etc.), or `null` until one is seen. Powers the dock's Open
	 * button. Always `null` for non-run-script sessions.
	 */
	previewUrl: string | null;
	/**
	 * True when this session was relaunched from a persisted dock terminal on app
	 * restart, its prior output seeded into the scrollback ahead of live PTY data.
	 * Lets the tab badge the replay as restored history. `false` for fresh spawns.
	 */
	restored: boolean;
	rows: number;
	/**
	 * Name of the repository run script this session runs, or `null` for every
	 * other session kind. Lets the dock show which of several configured run
	 * scripts is live and gate the Run button on it.
	 */
	scriptName: string | null;
	status: TerminalSessionStatus;
	/**
	 * Position of this interactive terminal among the workspace's dock terminals,
	 * counting from 1, so unnamed tabs read `Terminal 1`, `Terminal 2`, and so on.
	 * `null` for every other kind — setup, run, archive, and agent sessions are not
	 * numbered. Assigned once at creation as the lowest number no live dock
	 * terminal holds and never reassigned, so closing one tab does not renumber the
	 * rest; the number is released when its own tab closes.
	 */
	terminalNumber: number | null;
	title: string;
	/**
	 * True while {@link title} is the English stand-in main assigns a session that
	 * was never named — by the user, by an OSC escape, or by a harness log. The
	 * renderer names those from {@link kind} in the app's language and keeps the
	 * English text only for the support bundle.
	 */
	titleIsDefault: boolean;
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
	/**
	 * Id of the persisted dock terminal this create relaunches. When set, the
	 * previous session's stored output log is superseded and removed once its
	 * output is seeded into the new session.
	 */
	restoredFromId?: string;
	rows?: number;
	/**
	 * Prior scrollback to seed ahead of live PTY output when relaunching a
	 * persisted dock terminal, so the restored tab replays its history first.
	 */
	seedOutput?: string;
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

/** Request to list terminal sessions. */
export interface ListTerminalSessionsRequest {
	/**
	 * Workspace to scope the listing to. Omit to list every live session across
	 * all workspaces, which is how the sidebar seeds activity badges for
	 * workspaces whose route is not mounted.
	 */
	workspaceId?: string;
}

/** The listed terminal sessions. */
export interface ListTerminalSessionsResult {
	sessions: TerminalSessionSnapshot[];
}

/** Request for a workspace's restorable dock terminals. */
export interface ListRestorableTerminalsRequest {
	workspaceId: string;
}

/**
 * One interactive dock terminal that was open when the app last quit and whose
 * output was persisted, offered to the renderer to relaunch on restore.
 */
export interface RestorableTerminal {
	/** Id of the persisted session, passed back as `restoredFromId` on relaunch. */
	id: string;
	/** Persisted scrollback to seed into the relaunched session. */
	output: string;
	title: string;
	/**
	 * True when {@link title} is the English stand-in rather than a name anyone
	 * chose. The relaunch drops it instead of adopting it, so a terminal nobody
	 * named comes back as an unnamed, numbered tab in the app's language rather
	 * than the literal word "Terminal".
	 */
	titleIsDefault: boolean;
}

/** The dock terminals a workspace can relaunch after restart. */
export interface ListRestorableTerminalsResult {
	terminals: RestorableTerminal[];
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
	listRestorableTerminals: (
		request: ListRestorableTerminalsRequest,
	) => Promise<ListRestorableTerminalsResult>;
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
