import { randomUUID } from 'node:crypto';
import {
	harnessBusySource,
	harnessSessionLogSource,
	type SessionLogSource,
} from '../../shared/agents/harness-registry.ts';
import type {
	CreateTerminalSessionResult,
	RestorableTerminal,
	TerminalDiagnostic,
	TerminalLifecycleBroadcast,
	TerminalOutputBroadcast,
	TerminalSessionKind,
	TerminalSessionSnapshot,
	TerminalSessionStatus,
	TerminalSnapshotResult,
} from '../../shared/ipc/contracts/terminal';
import { detectPreviewUrl } from '../../shared/terminal/detect-preview-url.ts';
import type { WorkspaceEnvironmentService } from '../environment';
import { stripLaunchContextEnv } from '../environment/launch-env.ts';
import { WorkspaceEnvironmentError } from '../environment/workspace-environment.ts';
import { isRecord, isString } from '../repository/row-guards.ts';
import type { EnsemblrDatabaseService } from '../storage';
import {
	finalizeTerminalSessionRow,
	insertTerminalSessionRow,
	markStaleRunningTerminalSessions,
	type RestorableTerminalSessionRow,
	selectRestorableTerminalSessionRows,
} from '../storage/repositories/terminal-session-repository.ts';
import {
	type AgentConversationInfo,
	type ReadAgentConversationTitleOptions,
	readAgentConversationInfo,
} from './agent-conversation-title.ts';
import {
	createNodePtyBackend,
	type PtyBackend,
	type PtyProcess,
} from './pty-backend.ts';
import {
	deleteTerminalOutput,
	readTerminalOutput,
	writeTerminalOutput,
} from './terminal-output-file.ts';
import {
	createScrollbackBuffer,
	DEFAULT_SCROLLBACK_LIMIT,
	type ScrollbackBuffer,
} from './terminal-scrollback.ts';
import { resolveScriptShell, resolveUserShell } from './user-shell.ts';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MIN_DIMENSION = 2;
const MAX_DIMENSION = 1_000;
const DEFAULT_KILL_GRACE_MS = 5_000;
// Defense-in-depth against a compromised renderer flooding the PTY buffer.
const MAX_WRITE_BYTES = 65_536;

/**
 * How long to coalesce a session's output writes before flushing scrollback to
 * disk. Long enough that a chatty PTY does not thrash the filesystem, short
 * enough that a crash loses little tail output.
 */
const OUTPUT_FLUSH_DEBOUNCE_MS = 1_000;

/**
 * Dim separator appended after a restored session's seeded scrollback, marking
 * where the previous run's replayed output ends and the fresh shell begins. Built
 * without literal control characters, matching the OSC helpers below.
 */
const RESTORE_BANNER = `\r\n${String.fromCharCode(27)}[2m── restored session — output above is from the previous run ──${String.fromCharCode(27)}[0m\r\n`;

/**
 * Reports whether a session kind is persisted to disk and offered for dock
 * restore after a restart. Only plain interactive terminals qualify: agent tabs
 * carry their own on-disk session logs and resume through the harness path, and
 * script kinds (run/setup/archive) are transient runs that are never re-offered.
 * The single source of truth for both the write side and the restore side, so
 * the two can never persist a kind that restore would then orphan.
 * @param kind - The session kind to test.
 * @returns True only for interactive dock terminals.
 */
function isRestorableTerminalKind(kind: TerminalSessionKind): boolean {
	return kind === 'terminal';
}

/** Machine-readable failure categories raised by the terminal service. */
export type TerminalServiceErrorCode = 'session-not-found';

/** Domain-specific error thrown by the terminal service. */
export class TerminalServiceError extends Error {
	readonly code: TerminalServiceErrorCode;

	/**
	 * @param code - Machine-readable failure category.
	 * @param message - Human-readable failure description.
	 */
	constructor(code: TerminalServiceErrorCode, message: string) {
		super(message);
		this.name = 'TerminalServiceError';
		this.code = code;
	}
}

/** Inputs for {@link TerminalService.create}. */
export interface CreateTerminalSessionOptions {
	cols?: number;
	command?: string;
	/**
	 * Harness registry id when the session runs an agent harness. Persisted in the
	 * session's metadata so a restart can identify which harness to resume.
	 */
	harnessId?: string;
	kind?: TerminalSessionKind;
	/**
	 * True when this session reattaches a harness's prior conversation after a
	 * restart (a cwd-scoped resume). The on-disk title log predates this session's
	 * `createdAt`, so the conversation-title reader must skip its launch-time gate
	 * and adopt the newest cwd-matching session — otherwise the resumed tab reverts
	 * to the generic harness label. Fresh launches leave this false to keep the gate.
	 */
	resumed?: boolean;
	/**
	 * Id of the persisted dock terminal this create relaunches. When set, its
	 * stored output log is removed once {@link seedOutput} has been seeded.
	 */
	restoredFromId?: string;
	/**
	 * Prior scrollback seeded ahead of live PTY output when relaunching a
	 * persisted dock terminal, so the restored tab replays its history first.
	 */
	seedOutput?: string;
	title?: string;
	rows?: number;
	workspaceId: string;
}

/** Public surface of the main-process terminal service. */
export interface TerminalService {
	create: (
		options: CreateTerminalSessionOptions,
	) => Promise<CreateTerminalSessionResult>;
	disposeAll: () => void;
	getSnapshot: (terminalId: string) => TerminalSnapshotResult;
	kill: (terminalId: string) => TerminalSessionSnapshot | null;
	list: (workspaceId: string) => TerminalSessionSnapshot[];
	/**
	 * Interactive dock terminals a workspace can relaunch after restart: those
	 * open at last quit whose output was persisted. One-shot per workspace — the
	 * set is consumed on read so a remount does not re-offer them.
	 */
	listRestorable: (workspaceId: string) => RestorableTerminal[];
	recoverStaleSessions: () => void;
	resize: (terminalId: string, cols: number, rows: number) => void;
	/**
	 * Resolves `true` once the session is no longer running (immediately for
	 * unknown or already-ended sessions), or `false` when `timeoutMs` elapses
	 * first.
	 */
	waitForExit: (terminalId: string, timeoutMs?: number) => Promise<boolean>;
	write: (terminalId: string, data: string) => void;
}

/** Environment map used as the base for PTY children. */
export type TerminalBaseEnv = NodeJS.ProcessEnv;

/** Resolves the inherited environment used as the base for PTY children. */
export type TerminalBaseEnvResolver = () =>
	| Promise<TerminalBaseEnv>
	| TerminalBaseEnv;

/** Options for {@link createTerminalService}. */
export interface CreateTerminalServiceOptions {
	backend?: PtyBackend;
	databaseService: EnsemblrDatabaseService;
	/** Shell for interactive terminals; defaults to the user's login shell. */
	defaultShell?: string;
	killGraceMs?: number;
	now?: () => Date;
	onLifecycle: (event: TerminalLifecycleBroadcast) => void;
	/**
	 * Called when an agent session's native session id is first read from its
	 * on-disk log, so the wiring layer can persist it onto the backing chat tab
	 * for exact-conversation resume after a restart. Terminal-service stays free of
	 * chat-tab knowledge; the seam carries only ids. Omitted → not persisted.
	 */
	onAgentSessionCaptured?: (input: {
		agentSessionId: string;
		terminalId: string;
		workspaceId: string;
	}) => void;
	onOutput: (event: TerminalOutputBroadcast) => void;
	/**
	 * Reads an agent harness's conversation title and native session id from its
	 * on-disk session log. Injectable for tests; defaults to the real filesystem
	 * reader.
	 */
	readConversationInfo?: (
		source: SessionLogSource,
		cwd: string,
		options?: ReadAgentConversationTitleOptions,
	) => Promise<AgentConversationInfo>;
	/**
	 * Resolves the user's shell-derived environment so setup/run scripts inherit
	 * the same PATH and toolchain shims as diagnostics and Pi sessions.
	 */
	resolveBaseEnv?: TerminalBaseEnvResolver;
	/**
	 * Resolves the pty scrollback byte limit from the user's
	 * `appearance.terminalScrollbackMb` setting. Read per new session so an edited
	 * limit applies to terminals opened after the change.
	 */
	resolveScrollbackLimit?: () => number;
	/**
	 * Shell for script commands. Stays a POSIX-compatible shell on purpose:
	 * repository scripts routinely use `VAR=x cmd` and other constructs that
	 * fish rejects, so the user's interactive shell must not leak in here.
	 */
	scriptShell?: string;
	workspaceEnvironmentService: WorkspaceEnvironmentService;
}

/** Internal: one tracked session. */
interface TrackedSession {
	/**
	 * Idle timer that clears {@link TerminalSessionSnapshot.agentBusy} once a
	 * `pty-spinner` harness (Vibe) stops streaming spinner glyphs, or null when the
	 * tab is not busy. Only used for {@link busyFromPtySpinner} sessions.
	 */
	agentBusyIdleTimer: NodeJS.Timeout | null;
	/**
	 * True when this agent tab derives its busy state from braille spinner glyphs in
	 * PTY output (Vibe) rather than from a spinner in its OSC title.
	 */
	busyFromPtySpinner: boolean;
	/**
	 * Harness session-log source read for the conversation title (Codex, Vibe) and
	 * native session id (all harnesses), or null for non-agent sessions.
	 */
	sessionLogSource: SessionLogSource | null;
	/**
	 * Launch time gating the on-disk session-log reader, or null to disable the
	 * gate. Set to this session's `createdAt` for a fresh launch so it never adopts
	 * a prior conversation's title/id; null when resuming, where the log predates
	 * this session and the newest cwd-matching session is the right one.
	 */
	sessionLogSince: string | null;
	/** Working directory the PTY spawned in, used to match on-disk session logs. */
	cwd: string;
	dataSubscription: { dispose: () => void } | null;
	exitSubscription: { dispose: () => void } | null;
	exitWaiters: Array<() => void>;
	killTimer: NodeJS.Timeout | null;
	/**
	 * Debounce timer coalescing scrollback writes to disk for persisted dock
	 * kinds, or null when no flush is pending. Unset for agent sessions.
	 */
	outputFlushTimer: NodeJS.Timeout | null;
	outputSeq: number;
	/** Poll timer re-reading the harness conversation title, or null when idle. */
	titlePollTimer: NodeJS.Timeout | null;
	/**
	 * Rolling tail of recent run-script output kept only until a preview URL is
	 * found. PTY output arrives in arbitrary fragments, so a dev-server URL can
	 * straddle two chunks; matching against this window instead of a lone chunk
	 * stops a split banner from hiding the dock's Open button.
	 */
	previewScanBuffer: string;
	/**
	 * Rolling tail of recent agent-terminal output kept to reassemble an OSC
	 * window-title escape (`ESC ]0;…BEL`) that may straddle two PTY chunks.
	 */
	titleScanBuffer: string;
	pty: PtyProcess | null;
	scrollback: ScrollbackBuffer;
	snapshot: TerminalSessionSnapshot;
	stopRequested: boolean;
}

/**
 * How many trailing characters of run-script output to keep while hunting for a
 * preview URL. Comfortably longer than any dev-server banner line, so a URL
 * split across chunks still lands whole inside the window.
 */
const PREVIEW_SCAN_WINDOW = 8192;

/**
 * How many trailing characters of agent-terminal output to retain while waiting
 * for an OSC title escape to terminate. Comfortably longer than any title line.
 */
const TITLE_SCAN_WINDOW = 512;

/**
 * How often to re-read a harness's on-disk conversation title. The harness writes
 * its session log as the conversation progresses, so this keeps the tab label
 * current (e.g. a Vibe title that only lands once a turn completes).
 */
const CONVERSATION_TITLE_POLL_MS = 1_500;

/**
 * How long a `pty-spinner` harness (Vibe) stays flagged busy after its last braille
 * spinner glyph. Comfortably longer than the spinner's redraw cadence (its elapsed
 * counter repaints at least once a second) so a working tab stays lit, short enough
 * that going idle clears the indicator promptly.
 */
const PTY_SPINNER_BUSY_IDLE_MS = 1_500;

/**
 * Ceiling on the one final session-log read taken as a PTY exits. This read
 * gates {@link finalizeSession} — and with it every exit waiter — so a stuck
 * filesystem must not wedge session teardown. Comfortably longer than a healthy
 * bounded head read, short enough that a stall still finalizes promptly.
 */
const FINAL_CONVERSATION_READ_TIMEOUT_MS = 2_000;

/** Neutral conversation info used when the exit-time read times out. */
const EMPTY_CONVERSATION_INFO: AgentConversationInfo = {
	sessionId: null,
	title: null,
};

/**
 * Races a promise against a millisecond deadline, resolving to `fallback` when
 * the deadline wins first. The timer is unref'd so it never keeps the app alive
 * and is always cleared once the race settles.
 * @param work - The promise to bound.
 * @param ms - Deadline in milliseconds.
 * @param fallback - Value resolved when the deadline wins.
 * @returns The work's value, or `fallback` on timeout.
 */
function raceWithTimeout<T>(
	work: Promise<T>,
	ms: number,
	fallback: T,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<T>((resolve) => {
		timer = setTimeout(() => resolve(fallback), ms);
		timer.unref?.();
	});
	return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Unicode braille block (U+2800–U+28FF), the frames Vibe animates as its spinner. */
const BRAILLE_BLOCK_START = 0x2800;
const BRAILLE_BLOCK_END = 0x28ff;

/**
 * Reports whether a PTY output chunk contains a braille spinner glyph, the signal
 * that a `pty-spinner` harness (Vibe) is animating its "working" indicator.
 * @param data - A raw PTY output chunk.
 * @returns True when any character falls in the braille block.
 */
function containsBrailleSpinner(data: string): boolean {
	for (const char of data) {
		const codePoint = char.codePointAt(0) ?? 0;
		if (codePoint >= BRAILLE_BLOCK_START && codePoint <= BRAILLE_BLOCK_END) {
			return true;
		}
	}
	return false;
}

/**
 * Matches an OSC window-title escape: `ESC ] (0|1|2) ; <title> (BEL | ESC \)`.
 * Built without literal control characters. Both terminators are accepted: agent
 * TUIs are split between the BEL form (Claude) and the ST form `ESC \` (Codex,
 * Gemini, Vibe). The capture class already excludes BEL and ESC, so it stops
 * cleanly before either terminator.
 */
const OSC_TITLE_ESC = String.fromCharCode(27);
const OSC_TITLE_BEL = String.fromCharCode(7);
// ST terminator is `ESC \`; the backslash is doubled so the regex source matches
// a literal backslash instead of escaping the group's closing paren.
const OSC_TITLE_ST = `${OSC_TITLE_ESC}\\\\`;
const OSC_TITLE_PATTERN = new RegExp(
	`${OSC_TITLE_ESC}][012];([^${OSC_TITLE_BEL}${OSC_TITLE_ESC}]*)(?:${OSC_TITLE_BEL}|${OSC_TITLE_ST})`,
	'g',
);

/**
 * Computes the snapshot fields to update from a freshly read conversation info,
 * keeping only the title and session id that actually changed. Returns null when
 * nothing changed, so the caller can skip a redundant broadcast.
 * @param snapshot - The session's current snapshot.
 * @param info - The latest title and session id read from the harness log.
 * @returns A partial snapshot patch, or null when neither field changed.
 */
function conversationInfoPatch(
	snapshot: TerminalSessionSnapshot,
	info: AgentConversationInfo,
): Partial<TerminalSessionSnapshot> | null {
	const patch: Partial<TerminalSessionSnapshot> = {};
	if (info.title && info.title !== snapshot.agentTitle) {
		patch.agentTitle = info.title;
	}
	if (info.sessionId && info.sessionId !== snapshot.agentSessionId) {
		patch.agentSessionId = info.sessionId;
	}
	return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Builds the main-process PTY supervisor used by terminal dock tabs and script
 * execution. Owns process lifecycle (spawn, input, resize, SIGHUP→SIGKILL
 * termination), bounded scrollback for renderer re-attach, SQLite session
 * metadata, and output/lifecycle broadcasts. The renderer only renders.
 * @param options - Service dependencies.
 * @returns A fresh {@link TerminalService}.
 */
export function createTerminalService({
	backend = createNodePtyBackend(),
	databaseService,
	defaultShell = resolveUserShell(),
	killGraceMs = DEFAULT_KILL_GRACE_MS,
	now = () => new Date(),
	onAgentSessionCaptured,
	onLifecycle,
	onOutput,
	readConversationInfo = readAgentConversationInfo,
	resolveBaseEnv = () => process.env,
	resolveScrollbackLimit = () => DEFAULT_SCROLLBACK_LIMIT,
	scriptShell = resolveScriptShell(),
	workspaceEnvironmentService,
}: CreateTerminalServiceOptions): TerminalService {
	const sessions = new Map<string, TrackedSession>();
	// Dock terminals that were open at the previous quit, captured on startup
	// before their rows are marked stale. Consumed one-shot by listRestorable so
	// a renderer remount does not re-offer an already-relaunched tab.
	const restorableByWorkspace = new Map<
		string,
		RestorableTerminalSessionRow[]
	>();

	/**
	 * Returns the active SQLite connection, or null when no database is open.
	 * @returns The database handle, or null
	 */
	function getDatabase() {
		return databaseService.getConnection()?.database ?? null;
	}

	/**
	 * Looks up a tracked session by id, throwing when it is not registered.
	 * @param terminalId - Id of the terminal session to fetch
	 * @returns The tracked session
	 */
	function requireSession(terminalId: string): TrackedSession {
		const session = sessions.get(terminalId);

		if (!session) {
			throw new TerminalServiceError(
				'session-not-found',
				`No terminal session is registered with id ${terminalId}.`,
			);
		}

		return session;
	}

	/**
	 * Emits a lifecycle event carrying the session's current snapshot.
	 * @param session - Tracked session whose state to broadcast
	 */
	function broadcastLifecycle(session: TrackedSession): void {
		onLifecycle({
			session: { ...session.snapshot },
			terminalId: session.snapshot.id,
			workspaceId: session.snapshot.workspaceId,
		});
	}

	/**
	 * Builds a session's scrollback buffer, seeding a restored terminal's prior
	 * output and the {@link RESTORE_BANNER} ahead of any live PTY data so the
	 * replayed history reads before the fresh shell. Fresh spawns get an empty
	 * buffer.
	 * @param seedOutput - Prior scrollback to replay, or undefined for a fresh spawn.
	 * @returns A scrollback buffer at the user's configured limit.
	 */
	function buildSessionScrollback(
		seedOutput: string | undefined,
	): ScrollbackBuffer {
		const scrollback = createScrollbackBuffer(resolveScrollbackLimit());

		if (seedOutput) {
			scrollback.append(seedOutput);
			scrollback.append(RESTORE_BANNER);
		}

		return scrollback;
	}

	/**
	 * Removes the persisted output log of the dock terminal a restore superseded,
	 * so the next restart restores from the freshly relaunched session rather than
	 * the stale one. No-op when this create is not a restore.
	 * @param cwd - Worktree root whose `.context/terminals` holds the log.
	 * @param restoredFromId - Id of the superseded session, or undefined.
	 */
	function discardRestoredLog(
		cwd: string,
		restoredFromId: string | undefined,
	): void {
		if (restoredFromId) {
			deleteTerminalOutput(cwd, restoredFromId);
		}
	}

	/** Clears a session's pending debounced flush timer, if one is armed. */
	function clearOutputFlushTimer(session: TrackedSession): void {
		if (session.outputFlushTimer) {
			clearTimeout(session.outputFlushTimer);
			session.outputFlushTimer = null;
		}
	}

	/**
	 * Writes a restorable session's current scrollback to its `.context` output
	 * log so a later app run can replay it. No-op for non-restorable kinds.
	 * Best-effort — the writer swallows errors.
	 * @param session - Tracked session whose scrollback to persist.
	 */
	function persistSessionOutput(session: TrackedSession): void {
		if (!isRestorableTerminalKind(session.snapshot.kind)) {
			return;
		}

		writeTerminalOutput(
			session.cwd,
			session.snapshot.id,
			session.scrollback.read(),
		);
	}

	/**
	 * Flushes a session's scrollback to disk immediately and cancels any pending
	 * debounced flush. Used on quit and before an active session is torn down.
	 * @param session - Tracked session whose scrollback to persist.
	 */
	function flushSessionOutput(session: TrackedSession): void {
		clearOutputFlushTimer(session);
		persistSessionOutput(session);
	}

	/**
	 * Drops a session's persisted output log and cancels any pending flush. Called
	 * when a session terminates normally: its row is no longer `running`, so it is
	 * never restorable and its log would otherwise linger as a secret-bearing
	 * orphan in `.context/terminals`. No-op for non-restorable kinds.
	 * @param session - Tracked session that has ended.
	 */
	function discardSessionOutput(session: TrackedSession): void {
		clearOutputFlushTimer(session);
		if (isRestorableTerminalKind(session.snapshot.kind)) {
			deleteTerminalOutput(session.cwd, session.snapshot.id);
		}
	}

	/**
	 * Schedules a debounced scrollback flush for a restorable session, coalescing
	 * bursty output into one write. No-op for non-restorable kinds. The timer is
	 * unref'd so a pending flush never keeps the app alive.
	 * @param session - Tracked session whose output changed.
	 */
	function scheduleOutputFlush(session: TrackedSession): void {
		if (
			!isRestorableTerminalKind(session.snapshot.kind) ||
			session.outputFlushTimer
		) {
			return;
		}

		session.outputFlushTimer = setTimeout(() => {
			session.outputFlushTimer = null;
			persistSessionOutput(session);
		}, OUTPUT_FLUSH_DEBOUNCE_MS);
		session.outputFlushTimer.unref?.();
	}

	/**
	 * Scans a run-script output chunk for a local dev-server URL and, on the
	 * first hit, stamps it on the session and broadcasts so the dock's Open
	 * button appears. No-ops for other kinds or once a URL is already known.
	 */
	function maybeDetectPreviewUrl(session: TrackedSession, data: string): void {
		if (session.snapshot.kind !== 'run-script' || session.snapshot.previewUrl) {
			return;
		}

		session.previewScanBuffer = (session.previewScanBuffer + data).slice(
			-PREVIEW_SCAN_WINDOW,
		);

		const previewUrl = detectPreviewUrl(session.previewScanBuffer);

		if (!previewUrl) {
			return;
		}

		session.previewScanBuffer = '';
		session.snapshot = { ...session.snapshot, previewUrl };
		broadcastLifecycle(session);
	}

	/**
	 * Captures the window title an agent harness sets via an OSC escape and, when
	 * it changes, stamps it on the session and broadcasts so the harness's own
	 * conversation title surfaces on its tab. No-op for non-agent sessions.
	 */
	function maybeCaptureOscTitle(session: TrackedSession, data: string): void {
		if (session.snapshot.kind !== 'agent') {
			return;
		}

		session.titleScanBuffer += data;
		let latestTitle: string | null = null;
		let consumedEnd = 0;
		for (const match of session.titleScanBuffer.matchAll(OSC_TITLE_PATTERN)) {
			latestTitle = match[1] ?? '';
			consumedEnd = (match.index ?? 0) + match[0].length;
		}

		if (consumedEnd > 0) {
			session.titleScanBuffer = session.titleScanBuffer.slice(consumedEnd);
		}
		if (session.titleScanBuffer.length > TITLE_SCAN_WINDOW) {
			session.titleScanBuffer = session.titleScanBuffer.slice(
				-TITLE_SCAN_WINDOW,
			);
		}

		if (latestTitle === null) {
			return;
		}
		const nextTitle = latestTitle.trim();
		if (nextTitle && nextTitle !== session.snapshot.title) {
			session.snapshot = { ...session.snapshot, title: nextTitle };
			broadcastLifecycle(session);
		}
	}

	/**
	 * Reads a harness's on-disk conversation title and native session id once and,
	 * when either changed, stamps it on the snapshot and broadcasts. No-op for
	 * sessions without a session-log source or once they stop running. The reader
	 * swallows filesystem errors, so a missing or half-written log yields no update.
	 * @param session - Tracked agent session to refresh.
	 */
	async function refreshConversationInfo(
		session: TrackedSession,
	): Promise<void> {
		if (!session.sessionLogSource || session.snapshot.status !== 'running') {
			return;
		}
		const info = await readConversationInfo(
			session.sessionLogSource,
			session.cwd,
			{ since: session.sessionLogSince ?? undefined },
		);
		const patch = conversationInfoPatch(session.snapshot, info);
		if (!patch) {
			return;
		}
		session.snapshot = { ...session.snapshot, ...patch };
		notifyAgentSessionCaptured(session, patch);
		broadcastLifecycle(session);
	}

	/**
	 * Forwards a newly captured native session id to the wiring layer so it can be
	 * persisted onto the backing chat tab. No-op when the patch carries no id or no
	 * seam was injected, so a title-only patch never triggers a write.
	 * @param session - Tracked agent session the id belongs to.
	 * @param patch - The snapshot patch just applied.
	 */
	function notifyAgentSessionCaptured(
		session: TrackedSession,
		patch: Partial<TerminalSessionSnapshot>,
	): void {
		if (!onAgentSessionCaptured || !patch.agentSessionId) {
			return;
		}
		onAgentSessionCaptured({
			agentSessionId: patch.agentSessionId,
			terminalId: session.snapshot.id,
			workspaceId: session.snapshot.workspaceId,
		});
	}

	/**
	 * Reads a harness's session log one last time as the PTY exits and stamps a
	 * newly captured native session id onto the snapshot. Unlike the interval
	 * poller it never broadcasts — the imminent {@link finalizeSession} broadcasts
	 * the stopped snapshot, carrying this id to the renderer's close path. Closes
	 * the gap where the id lands on disk between the final poll tick and process
	 * exit; without it that id would never reach the archived tab, so a restore
	 * would spawn a fresh conversation. The read is bounded by
	 * {@link FINAL_CONVERSATION_READ_TIMEOUT_MS} so a stuck filesystem cannot wedge
	 * the exit finalization this gates; on timeout it keeps the id already known.
	 * @param session - Tracked agent session that is exiting.
	 */
	async function captureFinalConversationInfo(
		session: TrackedSession,
	): Promise<void> {
		if (!session.sessionLogSource) {
			return;
		}
		const info = await raceWithTimeout(
			readConversationInfo(session.sessionLogSource, session.cwd, {
				since: session.sessionLogSince ?? undefined,
			}),
			FINAL_CONVERSATION_READ_TIMEOUT_MS,
			EMPTY_CONVERSATION_INFO,
		);
		const patch = conversationInfoPatch(session.snapshot, info);
		if (patch) {
			session.snapshot = { ...session.snapshot, ...patch };
			notifyAgentSessionCaptured(session, patch);
		}
	}

	/**
	 * Starts polling a harness's on-disk session log for agent sessions, refreshing
	 * the conversation title (Codex, Vibe) and native session id (all harnesses).
	 * Reads immediately, then on an interval; the timer is unref'd so it never keeps
	 * the app alive and is cleared when the session finalizes. No-op for others.
	 * @param session - Tracked agent session to begin polling.
	 */
	function startConversationInfoPolling(session: TrackedSession): void {
		if (!session.sessionLogSource) {
			return;
		}
		void refreshConversationInfo(session);
		session.titlePollTimer = setInterval(() => {
			void refreshConversationInfo(session);
		}, CONVERSATION_TITLE_POLL_MS);
		session.titlePollTimer.unref?.();
	}

	/**
	 * Marks a `pty-spinner` agent tab (Vibe) busy on seeing a braille spinner glyph
	 * in its PTY output and arms an idle timer to clear it once the glyphs stop. The
	 * rising edge and the later idle clear each broadcast once; the renderer holds
	 * the flag between them, so no per-frame re-broadcast is needed. No-op for other
	 * sessions and once the session stops running.
	 * @param session - Tracked agent session whose output signalled work.
	 */
	function markPtySpinnerBusy(session: TrackedSession): void {
		if (!session.busyFromPtySpinner || session.snapshot.status !== 'running') {
			return;
		}
		if (!session.snapshot.agentBusy) {
			session.snapshot = { ...session.snapshot, agentBusy: true };
			broadcastLifecycle(session);
		}
		if (session.agentBusyIdleTimer) {
			clearTimeout(session.agentBusyIdleTimer);
		}
		session.agentBusyIdleTimer = setTimeout(() => {
			session.agentBusyIdleTimer = null;
			if (!session.snapshot.agentBusy) {
				return;
			}
			session.snapshot = { ...session.snapshot, agentBusy: false };
			broadcastLifecycle(session);
		}, PTY_SPINNER_BUSY_IDLE_MS);
		session.agentBusyIdleTimer.unref?.();
	}

	/**
	 * Tears down a session's PTY subscriptions, records its terminal status and
	 * exit code, persists the outcome when a database is available, and wakes any
	 * exit waiters and lifecycle listeners.
	 * @param session - Tracked session that has exited
	 * @param exitCode - Process exit code, or null when unknown
	 */
	function finalizeSession(
		session: TrackedSession,
		exitCode: number | null,
	): void {
		if (session.killTimer) {
			clearTimeout(session.killTimer);
			session.killTimer = null;
		}
		if (session.titlePollTimer) {
			clearInterval(session.titlePollTimer);
			session.titlePollTimer = null;
		}
		if (session.agentBusyIdleTimer) {
			clearTimeout(session.agentBusyIdleTimer);
			session.agentBusyIdleTimer = null;
		}

		// A terminated session's row is no longer restorable, so drop its persisted
		// log rather than leaving a secret-bearing orphan. Quit is the exception:
		// disposeAll disposes each exit subscription before signalling the PTY, so
		// this never runs during shutdown, keeping the still-'running' row and its
		// log recoverable on next launch.
		discardSessionOutput(session);

		session.dataSubscription?.dispose();
		session.exitSubscription?.dispose();
		session.dataSubscription = null;
		session.exitSubscription = null;
		session.pty = null;

		for (const notifyExit of session.exitWaiters.splice(0)) {
			notifyExit();
		}

		const endedAt = now().toISOString();
		const status: TerminalSessionStatus = session.stopRequested
			? 'stopped'
			: exitCode === 0
				? 'exited'
				: 'failed';

		session.snapshot = {
			...session.snapshot,
			endedAt,
			exitCode,
			status,
		};

		const database = getDatabase();

		if (database) {
			try {
				finalizeTerminalSessionRow({
					database,
					endedAt,
					id: session.snapshot.id,
					metadataJson: JSON.stringify({
						exitCode,
						kind: session.snapshot.kind,
						stopped: session.stopRequested,
					}),
					// SQLite CHECK has no 'stopped'; user stops persist as 'exited'
					// with metadata.stopped so history can still distinguish them.
					status: status === 'failed' ? 'failed' : 'exited',
				});
			} catch {
				// Persistence is advisory; the live session state already updated.
			}
		}

		broadcastLifecycle(session);
	}

	/**
	 * Assembles the workspace environment and spawns a PTY-backed terminal
	 * session, returning setup diagnostics with the live session snapshot — or
	 * diagnostics and a null session when the environment cannot be assembled.
	 * @returns Setup diagnostics and the created session, or a null session on failure
	 */
	async function create({
		cols = DEFAULT_COLS,
		command,
		harnessId,
		kind = 'terminal',
		restoredFromId,
		resumed = false,
		rows = DEFAULT_ROWS,
		seedOutput,
		title,
		workspaceId,
	}: CreateTerminalSessionOptions): Promise<CreateTerminalSessionResult> {
		const diagnostics: TerminalDiagnostic[] = [];

		let environment: Awaited<
			ReturnType<WorkspaceEnvironmentService['assemble']>
		>;

		try {
			environment = await workspaceEnvironmentService.assemble({ workspaceId });
		} catch (error) {
			if (error instanceof WorkspaceEnvironmentError) {
				return {
					diagnostics: [
						{
							code: error.code,
							message: error.message,
							severity: 'error',
						},
					],
					session: null,
				};
			}

			throw error;
		}

		for (const diagnostic of environment.diagnostics) {
			diagnostics.push({
				code: diagnostic.code,
				message: diagnostic.message,
				severity: diagnostic.severity,
			});
		}

		const normalizedCols = clampDimension(cols, DEFAULT_COLS);
		const normalizedRows = clampDimension(rows, DEFAULT_ROWS);
		const normalizedCommand = command?.trim() || null;
		const shell = normalizedCommand ? scriptShell : defaultShell;
		const args = buildShellArgs(normalizedCommand);
		const commandLabel = normalizedCommand ?? shell;
		const id = randomUUID();
		const createdAt = now().toISOString();
		const baseEnv = await resolveTerminalBaseEnv(resolveBaseEnv, diagnostics);
		const env = mergeProcessEnvironment({
			baseEnv,
			kind,
			overlay: environment.env,
		});

		let pty: PtyProcess;

		try {
			pty = backend.spawn({
				args,
				cols: normalizedCols,
				cwd: environment.cwd,
				env,
				file: shell,
				rows: normalizedRows,
			});
		} catch (error) {
			return {
				diagnostics: [
					...diagnostics,
					{
						code: 'spawn-failed',
						message:
							error instanceof Error
								? error.message
								: 'The terminal process could not be started.',
						severity: 'error',
					},
				],
				session: null,
			};
		}

		const sessionLogSource =
			kind === 'agent' ? harnessSessionLogSource(harnessId) : null;
		const busyFromPtySpinner =
			kind === 'agent' && harnessBusySource(harnessId) === 'pty-spinner';

		const restored = Boolean(seedOutput);
		const scrollback = buildSessionScrollback(seedOutput);

		const session: TrackedSession = {
			agentBusyIdleTimer: null,
			busyFromPtySpinner,
			sessionLogSince: resumed ? null : createdAt,
			sessionLogSource,
			cwd: environment.cwd,
			dataSubscription: null,
			exitSubscription: null,
			exitWaiters: [],
			killTimer: null,
			outputFlushTimer: null,
			outputSeq: 0,
			previewScanBuffer: '',
			titlePollTimer: null,
			titleScanBuffer: '',
			pty,
			scrollback,
			snapshot: {
				agentBusy: false,
				agentSessionId: null,
				agentTitle: null,
				cols: normalizedCols,
				commandLabel,
				createdAt,
				endedAt: null,
				exitCode: null,
				id,
				kind,
				previewUrl: null,
				restored,
				rows: normalizedRows,
				status: 'running',
				title: title?.trim() || defaultTitle(kind),
				workspaceId,
			},
			stopRequested: false,
		};

		discardRestoredLog(environment.cwd, restoredFromId);

		session.dataSubscription = pty.onData((data) => {
			session.outputSeq += 1;
			session.scrollback.append(data);
			scheduleOutputFlush(session);
			onOutput({ data, seq: session.outputSeq, terminalId: id, workspaceId });
			maybeDetectPreviewUrl(session, data);
			maybeCaptureOscTitle(session, data);
			if (session.busyFromPtySpinner && containsBrailleSpinner(data)) {
				markPtySpinnerBusy(session);
			}
		});
		session.exitSubscription = pty.onExit(({ exitCode }) => {
			// Plain terminals have no session log to read; finalize synchronously so
			// callers observe the exit immediately. Agent tabs first read their log
			// one last time to capture a just-written native session id before the
			// stopped snapshot broadcasts.
			if (!session.sessionLogSource) {
				finalizeSession(session, exitCode);
				return;
			}
			void captureFinalConversationInfo(session).finally(() => {
				finalizeSession(session, exitCode);
			});
		});

		sessions.set(id, session);
		startConversationInfoPolling(session);

		const database = getDatabase();

		if (database) {
			try {
				insertTerminalSessionRow({
					cwd: environment.cwd,
					database,
					id,
					metadataJson: JSON.stringify(
						harnessId ? { harnessId, kind } : { kind },
					),
					shell,
					status: 'running',
					timestamp: createdAt,
					title: session.snapshot.title,
					workspaceId,
				});
			} catch {
				diagnostics.push({
					code: 'metadata-not-persisted',
					message:
						'The terminal session is running, but its metadata could not be saved.',
					severity: 'warning',
				});
			}
		}

		broadcastLifecycle(session);

		return {
			diagnostics,
			session: { ...session.snapshot },
		};
	}

	/**
	 * Requests graceful termination of a running session via SIGHUP, escalating
	 * to SIGKILL after a grace window when the process ignores the signal.
	 * @param terminalId - Id of the terminal session to stop
	 * @returns The session's current snapshot
	 */
	function kill(terminalId: string): TerminalSessionSnapshot | null {
		const session = requireSession(terminalId);

		if (!session.pty || session.snapshot.status !== 'running') {
			return { ...session.snapshot };
		}

		session.stopRequested = true;
		session.pty.kill('SIGHUP');

		if (!session.killTimer) {
			session.killTimer = setTimeout(() => {
				session.killTimer = null;
				// Escalate when the process ignored SIGHUP past the grace window.
				if (session.pty && session.snapshot.status === 'running') {
					try {
						session.pty.kill('SIGKILL');
					} catch {
						// Process already exited between the check and the signal.
					}
				}
			}, killGraceMs);
			session.killTimer.unref?.();
		}

		return { ...session.snapshot };
	}

	return {
		create,
		disposeAll: () => {
			// Same SIGHUP→grace→SIGKILL path as kill(); the escalation timers are
			// unref'd, so a quitting app exits without waiting and the kernel
			// reaps anything that ignored SIGHUP once the PTY closes.
			//
			// Flush each session's scrollback and DETACH its exit handler before
			// signalling the PTY. A real shell exits on SIGHUP, and node-pty can
			// deliver 'exit' in the window Electron spends tearing down after
			// `will-quit` returns — which would run finalizeSession, flipping the
			// row to 'exited' and deleting the just-written log, leaving the open
			// tab unrecoverable. Detaching first keeps the row 'running' and its
			// log intact so the next launch can restore it.
			for (const session of sessions.values()) {
				flushSessionOutput(session);
				session.exitSubscription?.dispose();
				session.exitSubscription = null;
			}
			for (const terminalId of sessions.keys()) {
				try {
					kill(terminalId);
				} catch {
					// Session vanished mid-iteration; nothing left to stop.
				}
			}
		},
		getSnapshot: (terminalId) => {
			const session = sessions.get(terminalId);

			if (!session) {
				return { lastSeq: 0, scrollback: '', session: null };
			}

			return {
				lastSeq: session.outputSeq,
				scrollback: session.scrollback.read(),
				session: { ...session.snapshot },
			};
		},
		kill,
		list: (workspaceId) =>
			Array.from(sessions.values()).flatMap((session) =>
				session.snapshot.workspaceId === workspaceId
					? [{ ...session.snapshot }]
					: [],
			),
		listRestorable: (workspaceId) => {
			const rows = restorableByWorkspace.get(workspaceId);

			if (!rows) {
				return [];
			}

			restorableByWorkspace.delete(workspaceId);

			return rows.flatMap((row) => {
				const kind = restorableKindFromMetadata(row.metadataJson);
				if (!kind || !isRestorableTerminalKind(kind)) {
					return [];
				}

				const output = row.cwd ? readTerminalOutput(row.cwd, row.id) : null;

				return output ? [{ id: row.id, output, title: row.title }] : [];
			});
		},
		recoverStaleSessions: () => {
			const database = getDatabase();

			if (!database) {
				return;
			}

			restorableByWorkspace.clear();
			for (const row of selectRestorableTerminalSessionRows({ database })) {
				const existing = restorableByWorkspace.get(row.workspaceId) ?? [];
				restorableByWorkspace.set(row.workspaceId, [...existing, row]);
			}

			markStaleRunningTerminalSessions({
				database,
				timestamp: now().toISOString(),
			});
		},
		waitForExit: (terminalId, timeoutMs) => {
			const session = sessions.get(terminalId);

			if (session?.snapshot.status !== 'running') {
				return Promise.resolve(true);
			}

			return new Promise<boolean>((resolve) => {
				let timer: NodeJS.Timeout | null = null;
				const waiter = () => {
					if (timer) {
						clearTimeout(timer);
					}
					resolve(true);
				};

				if (timeoutMs !== undefined) {
					timer = setTimeout(() => {
						const index = session.exitWaiters.indexOf(waiter);

						if (index !== -1) {
							session.exitWaiters.splice(index, 1);
						}

						resolve(false);
					}, timeoutMs);
					timer.unref?.();
				}

				session.exitWaiters.push(waiter);
			});
		},
		resize: (terminalId, cols, rows) => {
			const session = requireSession(terminalId);
			const normalizedCols = clampDimension(cols, session.snapshot.cols);
			const normalizedRows = clampDimension(rows, session.snapshot.rows);

			session.snapshot = {
				...session.snapshot,
				cols: normalizedCols,
				rows: normalizedRows,
			};
			session.pty?.resize(normalizedCols, normalizedRows);
		},
		write: (terminalId, data) => {
			const session = requireSession(terminalId);
			session.pty?.write(data.slice(0, MAX_WRITE_BYTES));
		},
	};
}

/** Clamps a renderer-supplied dimension to a sane integer range. */
function clampDimension(value: number, fallback: number): number {
	if (!Number.isFinite(value)) {
		return fallback;
	}

	return Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, Math.round(value)));
}

/**
 * Reads the `kind` a terminal session persisted in its `metadata_json`, used to
 * decide restore eligibility. Returns null when the JSON is malformed or carries
 * no string kind, so only recognised dock kinds are ever restored.
 * @param metadataJson - The row's raw `metadata_json` text.
 * @returns The persisted session kind, or null.
 */
function restorableKindFromMetadata(
	metadataJson: string,
): TerminalSessionKind | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(metadataJson);
	} catch {
		return null;
	}

	return isRecord(parsed) && isString(parsed.kind)
		? (parsed.kind as TerminalSessionKind)
		: null;
}

/** Default tab title per session kind. */
function defaultTitle(kind: TerminalSessionKind): string {
	switch (kind) {
		case 'agent':
			return 'Agent';
		case 'archive-script':
			return 'Archive';
		case 'run-script':
			return 'Run';
		case 'setup-script':
			return 'Setup';
		case 'terminal':
			return 'Terminal';
	}
}

/**
 * Builds shell arguments for interactive login shells and non-interactive
 * scripts. Scripts intentionally avoid login startup files so the already
 * resolved shell environment remains authoritative.
 * @param command - Optional script command to run.
 * @returns Arguments passed to the selected shell.
 */
function buildShellArgs(command: string | null): string[] {
	return command ? ['-c', command] : ['-l'];
}

/**
 * Resolves the base PTY environment, falling back to the Electron process
 * environment when the configured resolver fails unexpectedly.
 * @param resolveBaseEnv - Base environment resolver.
 * @param diagnostics - Diagnostics collection to append fallback warnings to.
 * @returns Environment used as the base for terminal process spawning.
 */
async function resolveTerminalBaseEnv(
	resolveBaseEnv: TerminalBaseEnvResolver,
	diagnostics: TerminalDiagnostic[],
): Promise<TerminalBaseEnv> {
	try {
		return await resolveBaseEnv();
	} catch {
		diagnostics.push({
			code: 'base-env-unavailable',
			message:
				'The shell-derived terminal environment could not be resolved; using the app process environment instead.',
			severity: 'warning',
		});
		return process.env;
	}
}

/**
 * Merges the workspace overlay onto the inherited process environment,
 * dropping undefined values so the result is a clean string record. Fills in
 * the terminal-capability variables (truecolor, UTF-8 locale) that prompt
 * tooling like starship and fish's own highlighting rely on — GUI-launched
 * Electron processes often lack them.
 * @param input - Base environment, workspace overlay, and terminal kind.
 * @returns The merged environment.
 */
function mergeProcessEnvironment({
	baseEnv,
	kind,
	overlay,
}: {
	baseEnv: TerminalBaseEnv;
	kind: TerminalSessionKind;
	overlay: Record<string, string>;
}): Record<string, string> {
	const env: Record<string, string> = {};

	// Strip macOS/Electron launch-context vars so a terminal running `open` (or a
	// tool that shells out to it) can't make macOS relaunch Ensemblr as a second
	// instance. The default resolver returns raw process.env, so this strip is
	// load-bearing even when an upstream resolver already sanitized its output.
	for (const [key, value] of Object.entries(stripLaunchContextEnv(baseEnv))) {
		if (value !== undefined) {
			env[key] = value;
		}
	}

	if (!env.COLORTERM) {
		env.COLORTERM = 'truecolor';
	}

	if (!env.LANG) {
		env.LANG = 'en_US.UTF-8';
	}

	if (kind === 'terminal' || kind === 'agent') {
		env.TERM_PROGRAM = 'Ensemblr';
	}

	// Strip again AFTER the overlay merge: launch-context identity must never
	// reach a pty child, no matter which upstream source assembled the overlay.
	return stripLaunchContextEnv({ ...env, ...overlay });
}
