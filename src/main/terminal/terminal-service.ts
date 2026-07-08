import { randomUUID } from 'node:crypto';

import type {
	CreateTerminalSessionResult,
	TerminalDiagnostic,
	TerminalLifecycleBroadcast,
	TerminalOutputBroadcast,
	TerminalSessionKind,
	TerminalSessionSnapshot,
	TerminalSessionStatus,
	TerminalSnapshotResult,
} from '../../shared/ipc/contracts/terminal';
import { detectPreviewUrl } from '../../shared/terminal/detect-preview-url.ts';
import {
	WorkspaceEnvironmentError,
	type WorkspaceEnvironmentService,
} from '../environment/workspace-environment.ts';
import type { EnsembleDatabaseService } from '../storage/database.ts';
import {
	finalizeTerminalSessionRow,
	insertTerminalSessionRow,
	markStaleRunningTerminalSessions,
} from '../storage/repositories/terminal-session-repository.ts';
import {
	createNodePtyBackend,
	type PtyBackend,
	type PtyProcess,
} from './pty-backend.ts';
import {
	createScrollbackBuffer,
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
	kind?: TerminalSessionKind;
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

/** Options for {@link createTerminalService}. */
export interface CreateTerminalServiceOptions {
	backend?: PtyBackend;
	databaseService: EnsembleDatabaseService;
	/** Shell for interactive terminals; defaults to the user's login shell. */
	defaultShell?: string;
	killGraceMs?: number;
	now?: () => Date;
	onLifecycle: (event: TerminalLifecycleBroadcast) => void;
	onOutput: (event: TerminalOutputBroadcast) => void;
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
	dataSubscription: { dispose: () => void } | null;
	exitSubscription: { dispose: () => void } | null;
	exitWaiters: Array<() => void>;
	killTimer: NodeJS.Timeout | null;
	outputSeq: number;
	pty: PtyProcess | null;
	scrollback: ScrollbackBuffer;
	snapshot: TerminalSessionSnapshot;
	stopRequested: boolean;
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
	onLifecycle,
	onOutput,
	scriptShell = resolveScriptShell(),
	workspaceEnvironmentService,
}: CreateTerminalServiceOptions): TerminalService {
	const sessions = new Map<string, TrackedSession>();

	function getDatabase() {
		return databaseService.getConnection()?.database ?? null;
	}

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

	function broadcastLifecycle(session: TrackedSession): void {
		onLifecycle({
			session: { ...session.snapshot },
			terminalId: session.snapshot.id,
			workspaceId: session.snapshot.workspaceId,
		});
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

		const previewUrl = detectPreviewUrl(data);

		if (!previewUrl) {
			return;
		}

		session.snapshot = { ...session.snapshot, previewUrl };
		broadcastLifecycle(session);
	}

	function finalizeSession(
		session: TrackedSession,
		exitCode: number | null,
	): void {
		if (session.killTimer) {
			clearTimeout(session.killTimer);
			session.killTimer = null;
		}

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

	async function create({
		cols = DEFAULT_COLS,
		command,
		kind = 'terminal',
		rows = DEFAULT_ROWS,
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
		const args = normalizedCommand ? ['-l', '-c', normalizedCommand] : ['-l'];
		const commandLabel = normalizedCommand ?? shell;
		const id = randomUUID();
		const createdAt = now().toISOString();
		const env = mergeProcessEnvironment(environment.env, kind);

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

		const session: TrackedSession = {
			dataSubscription: null,
			exitSubscription: null,
			exitWaiters: [],
			killTimer: null,
			outputSeq: 0,
			pty,
			scrollback: createScrollbackBuffer(),
			snapshot: {
				cols: normalizedCols,
				commandLabel,
				createdAt,
				endedAt: null,
				exitCode: null,
				id,
				kind,
				previewUrl: null,
				rows: normalizedRows,
				status: 'running',
				title: title?.trim() || defaultTitle(kind),
				workspaceId,
			},
			stopRequested: false,
		};

		session.dataSubscription = pty.onData((data) => {
			session.outputSeq += 1;
			session.scrollback.append(data);
			onOutput({ data, seq: session.outputSeq, terminalId: id, workspaceId });
			maybeDetectPreviewUrl(session, data);
		});
		session.exitSubscription = pty.onExit(({ exitCode }) => {
			finalizeSession(session, exitCode);
		});

		sessions.set(id, session);

		const database = getDatabase();

		if (database) {
			try {
				insertTerminalSessionRow({
					cwd: environment.cwd,
					database,
					id,
					metadataJson: JSON.stringify({ kind }),
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
		recoverStaleSessions: () => {
			const database = getDatabase();

			if (!database) {
				return;
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

/** Default tab title per session kind. */
function defaultTitle(kind: TerminalSessionKind): string {
	switch (kind) {
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
 * Merges the workspace overlay onto the inherited process environment,
 * dropping undefined values so the result is a clean string record. Fills in
 * the terminal-capability variables (truecolor, UTF-8 locale) that prompt
 * tooling like starship and fish's own highlighting rely on — GUI-launched
 * Electron processes often lack them.
 * @param overlay - Workspace overlay variables.
 * @param kind - Session kind; only interactive terminals brand TERM_PROGRAM.
 * @returns The merged environment.
 */
function mergeProcessEnvironment(
	overlay: Record<string, string>,
	kind: TerminalSessionKind,
): Record<string, string> {
	const env: Record<string, string> = {};

	for (const [key, value] of Object.entries(process.env)) {
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

	if (kind === 'terminal') {
		env.TERM_PROGRAM = 'Ensemble';
	}

	return { ...env, ...overlay };
}
