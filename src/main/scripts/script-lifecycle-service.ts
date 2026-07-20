import type {
	CreateTerminalSessionResult,
	KillTerminalResult,
	TerminalSessionSnapshot,
} from '../../shared/ipc/contracts/terminal';
import type { WorkspaceScriptKind } from '../../shared/ipc/contracts/workspace-scripts';
import {
	parseWorkspaceScriptSettings,
	type WorkspaceScriptSettings,
} from '../../shared/scripts/script-settings.ts';
import type { EnsemblrConfigResolutionService } from '../config';
import { isRecord, isString } from '../repository/row-guards.ts';
import type { EnsemblrDatabaseService } from '../storage';
import { selectWorkspaceWithRepositoryById } from '../storage/repositories/workspace-repository.ts';
import type { TerminalService } from '../terminal';
import { computeSetupFingerprint } from './setup-fingerprint.ts';
import { readSetupStateFile, writeSetupStateFile } from './setup-state-file.ts';

const RESTART_WAIT_TIMEOUT_MS = 7_000;

/**
 * Longest the service waits for a setup or archive script to exit before it
 * gives up. Shared so both bounded waits use one value.
 */
const SCRIPT_EXIT_WAIT_TIMEOUT_MS = 60_000;

/** Inputs for {@link ScriptLifecycleService.runScript}. */
export interface RunScriptOptions {
	kind: WorkspaceScriptKind;
	/** Stop the active session of this kind before starting a new one. */
	restart?: boolean;
	workspaceId: string;
}

/** Inputs for {@link ScriptLifecycleService.stopScript}. */
export interface StopScriptOptions {
	kind: WorkspaceScriptKind;
	workspaceId: string;
}

/** Public surface of the script lifecycle service. */
export interface ScriptLifecycleService {
	/** Runs the archive script and resolves when it finishes (or times out). */
	runArchiveScriptAndWait: (options: {
		timeoutMs?: number;
		workspaceId: string;
	}) => Promise<void>;
	runScript: (
		options: RunScriptOptions,
	) => Promise<CreateTerminalSessionResult>;
	/**
	 * Runs the setup script only when the workspace's current dependency
	 * fingerprint differs from the last successful run. A matching fingerprint
	 * resolves to an info diagnostic without starting a session, so reopening a
	 * workspace never re-runs setup when nothing that affects it changed.
	 */
	runSetupScriptIfNeeded: (options: {
		workspaceId: string;
	}) => Promise<CreateTerminalSessionResult>;
	/**
	 * Runs the setup script and, when the repository has `autoRunAfterSetup`
	 * enabled and the setup exits successfully, chains the run script. Records
	 * the setup fingerprint on a clean exit so later opens can skip it.
	 */
	runSetupScriptWithAutoRun: (options: {
		workspaceId: string;
	}) => Promise<void>;
	stopScript: (options: StopScriptOptions) => Promise<KillTerminalResult>;
}

/** Options for {@link createScriptLifecycleService}. */
export interface CreateScriptLifecycleServiceOptions {
	databaseService: EnsemblrDatabaseService;
	settingsResolutionService: EnsemblrConfigResolutionService;
	terminalService: TerminalService;
}

/**
 * Builds the service that runs repository setup/run/archive scripts inside
 * workspace PTY sessions: resolves the configured command per repository
 * config precedence, enforces the resolved `runScriptMode`, and exposes
 * stop/restart controls. Output streams through the terminal dock.
 * @param options - Service dependencies.
 * @returns A fresh {@link ScriptLifecycleService}.
 */
export function createScriptLifecycleService({
	databaseService,
	settingsResolutionService,
	terminalService,
}: CreateScriptLifecycleServiceOptions): ScriptLifecycleService {
	const pendingExclusiveScriptStarts = new Map<
		string,
		Promise<CreateTerminalSessionResult>
	>();

	/** Resolves the configured command and run mode from the workspace worktree. */
	function resolveScriptConfig(
		workspaceId: string,
	):
		| { error: CreateTerminalSessionResult; settings: null }
		| { error: null; settings: WorkspaceScriptSettings } {
		const database = databaseService.getConnection()?.database ?? null;

		if (!database) {
			return {
				error: failure(
					'database-unavailable',
					'SQLite is unavailable; the script cannot be resolved.',
				),
				settings: null,
			};
		}

		const row = selectWorkspaceWithRepositoryById({ database, workspaceId });

		if (!isWorkspaceRow(row)) {
			return {
				error: failure(
					'workspace-not-found',
					`No workspace is registered with id ${workspaceId}.`,
				),
				settings: null,
			};
		}

		const snapshot = settingsResolutionService.resolve({
			repository: {
				repositoryId: row.repositoryId,
				repositoryPath: row.path,
			},
		});

		return {
			error: null,
			settings: parseWorkspaceScriptSettings(
				snapshot.repository?.settings ?? [],
			),
		};
	}

	/** Returns the active (running) script session of `kind`, if any. */
	function findActiveScriptSession(
		workspaceId: string,
		kind: WorkspaceScriptKind,
	): TerminalSessionSnapshot | null {
		return (
			terminalService
				.list(workspaceId)
				.find(
					(session) =>
						session.kind === `${kind}-script` && session.status === 'running',
				) ?? null
		);
	}

	/**
	 * Start a workspace's setup/run/archive script session, honoring restart and
	 * the resolved concurrency mode. Concurrent run launches start immediately;
	 * every other launch is serialized so overlapping requests cannot create
	 * duplicate sessions.
	 * @param options - Script kind, target workspace, and whether to restart a running session.
	 * @returns The terminal session create result, or a typed failure diagnostic.
	 */
	async function runScript({
		kind,
		restart = false,
		workspaceId,
	}: RunScriptOptions): Promise<CreateTerminalSessionResult> {
		const resolved = resolveScriptConfig(workspaceId);

		if (resolved.error) {
			return resolved.error;
		}

		const command = resolved.settings.scripts[kind];

		if (!command) {
			return failure(
				'script-not-configured',
				`No ${kind} script is configured for this repository.`,
				'info',
			);
		}

		const allowConcurrent =
			kind === 'run' &&
			resolved.settings.runScriptMode === 'concurrent' &&
			!restart;

		if (allowConcurrent) {
			return createScriptSession({ command, kind, workspaceId });
		}

		return runExclusiveScript({ command, kind, restart, workspaceId });
	}

	/**
	 * Serializes an exclusive script launch behind any in-flight launch for the
	 * same workspace and kind. The pending promise spans the entire decision —
	 * active-session check, restart kill/wait, and session create — so a
	 * concurrent request always observes the first launch's session before it
	 * decides, closing the duplicate-session race for both fresh starts and
	 * restarts.
	 * @param options - Resolved command, script kind, restart flag, and workspace.
	 * @returns The terminal session create result, or a typed failure diagnostic.
	 */
	async function runExclusiveScript({
		command,
		kind,
		restart,
		workspaceId,
	}: {
		command: string;
		kind: WorkspaceScriptKind;
		restart: boolean;
		workspaceId: string;
	}): Promise<CreateTerminalSessionResult> {
		const key = `${workspaceId}:${kind}`;
		const pendingStart = pendingExclusiveScriptStarts.get(key);

		if (pendingStart) {
			await pendingStart.catch(() => undefined);
		}

		const launch = launchExclusiveScript({
			command,
			kind,
			restart,
			workspaceId,
		});
		pendingExclusiveScriptStarts.set(key, launch);

		try {
			return await launch;
		} finally {
			if (pendingExclusiveScriptStarts.get(key) === launch) {
				pendingExclusiveScriptStarts.delete(key);
			}
		}
	}

	/**
	 * Decides and performs one exclusive launch: fails when a session is already
	 * running unless restart is set, in which case it stops the active session
	 * and waits for it to exit before starting the replacement.
	 * @param options - Resolved command, script kind, restart flag, and workspace.
	 * @returns The terminal session create result, or a typed failure diagnostic.
	 */
	async function launchExclusiveScript({
		command,
		kind,
		restart,
		workspaceId,
	}: {
		command: string;
		kind: WorkspaceScriptKind;
		restart: boolean;
		workspaceId: string;
	}): Promise<CreateTerminalSessionResult> {
		const activeSession = findActiveScriptSession(workspaceId, kind);

		if (activeSession) {
			if (!restart) {
				return failure(
					'script-already-running',
					`The ${kind} script is already running. Stop it or restart explicitly.`,
					'warning',
				);
			}

			terminalService.kill(activeSession.id);
			const exited = await terminalService.waitForExit(
				activeSession.id,
				RESTART_WAIT_TIMEOUT_MS,
			);

			if (!exited) {
				return failure(
					'script-restart-timeout',
					`The running ${kind} script did not stop in time; the restart was aborted.`,
					'warning',
				);
			}
		}

		return createScriptSession({ command, kind, workspaceId });
	}

	/**
	 * Creates a workspace terminal session for a script kind, applying the
	 * `<kind>-script` session kind and default dock title.
	 * @param options - Resolved command, script kind, and workspace.
	 * @returns The terminal session create result.
	 */
	function createScriptSession({
		command,
		kind,
		workspaceId,
	}: {
		command: string;
		kind: WorkspaceScriptKind;
		workspaceId: string;
	}): Promise<CreateTerminalSessionResult> {
		return terminalService.create({
			command,
			kind: `${kind}-script`,
			title: defaultScriptTitle(kind),
			workspaceId,
		});
	}

	/**
	 * Waits for a setup session to finish and, when it exits cleanly, records the
	 * dependency fingerprint so later opens can skip setup, then chains the run
	 * script if the repository enables `autoRunAfterSetup`. The wait is bounded;
	 * setup failures, hangs, and mid-flight stops skip both the record and the
	 * chain. Settings are re-read after the wait so a mid-setup opt-out is honored.
	 * @param options - The setup command, its session id, and the target workspace.
	 */
	async function finalizeSetup({
		command,
		sessionId,
		workspaceId,
	}: {
		command: string;
		sessionId: string;
		workspaceId: string;
	}): Promise<void> {
		const exited = await terminalService.waitForExit(
			sessionId,
			SCRIPT_EXIT_WAIT_TIMEOUT_MS,
		);

		if (
			!exited ||
			terminalService.getSnapshot(sessionId).session?.status !== 'exited'
		) {
			return;
		}

		recordSetupCompletion({ command, workspaceId });

		const fresh = resolveScriptConfig(workspaceId);

		if (
			fresh.error ||
			!fresh.settings.autoRunAfterSetup ||
			!fresh.settings.scripts.run
		) {
			return;
		}

		await runScript({ kind: 'run', workspaceId }).catch(() => {});
	}

	/**
	 * Persists the current setup fingerprint to the worktree's
	 * `.ensemblr/setup.local.json` marker. Best-effort: silently no-ops when
	 * SQLite or the workspace row is unavailable and swallows write errors, since
	 * a missed record only costs one redundant setup run on the next open.
	 * @param options - The setup command that completed and the target workspace.
	 */
	function recordSetupCompletion({
		command,
		workspaceId,
	}: {
		command: string;
		workspaceId: string;
	}): void {
		const database = databaseService.getConnection()?.database ?? null;

		if (!database) {
			return;
		}

		const row = selectWorkspaceWithRepositoryById({ database, workspaceId });

		if (!isWorkspaceRow(row)) {
			return;
		}

		writeSetupStateFile(row.path, {
			command,
			completedAt: new Date().toISOString(),
			fingerprint: computeSetupFingerprint({
				command,
				worktreePath: row.path,
			}),
		});
	}

	/**
	 * Reports whether a prior clean setup run still covers the current inputs, so
	 * setup can be skipped. Matches on both the command and the worktree
	 * fingerprint; the fingerprint (which reads lockfiles) is only computed when
	 * the recorded command matches.
	 * @param row - Workspace join row carrying the worktree `path`.
	 * @param command - The resolved setup command to compare against the record.
	 * @returns True when the recorded fingerprint matches the current inputs.
	 */
	function setupIsCurrent(row: { path: string }, command: string): boolean {
		const persisted = readSetupStateFile(row.path);

		if (!persisted || persisted.command !== command) {
			return false;
		}

		return (
			persisted.fingerprint ===
			computeSetupFingerprint({ command, worktreePath: row.path })
		);
	}

	/**
	 * Runs the setup script, then records its fingerprint and chains the run
	 * script per `autoRunAfterSetup` once it exits cleanly. Awaits the full tail
	 * so callers know setup (and any chained run) has settled.
	 */
	async function runSetupScriptWithAutoRun({
		workspaceId,
	}: {
		workspaceId: string;
	}): Promise<void> {
		const resolved = resolveScriptConfig(workspaceId);
		const command = resolved.error ? null : resolved.settings.scripts.setup;
		const setupResult = await runScript({ kind: 'setup', workspaceId });
		const setupSessionId = setupResult.session?.id;

		if (!command || !setupSessionId) {
			return;
		}

		await finalizeSetup({ command, sessionId: setupSessionId, workspaceId });
	}

	/**
	 * Runs the setup script only when the workspace's current dependency
	 * fingerprint differs from the last recorded successful run. A match returns
	 * an info diagnostic without starting a session; otherwise setup starts and
	 * its fingerprint is recorded in the background once it exits cleanly.
	 * @param options - The target workspace.
	 * @returns The launched setup session result, an info diagnostic when setup
	 *   is already current, or a typed failure.
	 */
	async function runSetupScriptIfNeeded({
		workspaceId,
	}: {
		workspaceId: string;
	}): Promise<CreateTerminalSessionResult> {
		const database = databaseService.getConnection()?.database ?? null;

		if (!database) {
			return failure(
				'database-unavailable',
				'SQLite is unavailable; the setup script cannot be resolved.',
			);
		}

		const resolved = resolveScriptConfig(workspaceId);

		if (resolved.error) {
			return resolved.error;
		}

		const command = resolved.settings.scripts.setup;

		if (!command) {
			return failure(
				'script-not-configured',
				'No setup script is configured for this repository.',
				'info',
			);
		}

		const row = selectWorkspaceWithRepositoryById({ database, workspaceId });

		if (!isWorkspaceRow(row)) {
			return failure(
				'workspace-not-found',
				`No workspace is registered with id ${workspaceId}.`,
			);
		}

		if (setupIsCurrent(row, command)) {
			return {
				diagnostics: [
					{
						code: 'setup-already-current',
						message:
							'Setup already ran for the current dependencies; skipping.',
						severity: 'info',
					},
				],
				session: null,
			};
		}

		const result = await runScript({ kind: 'setup', workspaceId });
		const sessionId = result.session?.id;

		if (sessionId) {
			void finalizeSetup({ command, sessionId, workspaceId });
		}

		return result;
	}

	/**
	 * Stop the active script session of a given kind for a workspace.
	 * @param options - Script kind and target workspace
	 * @returns The kill result, or an info diagnostic when no session is running
	 */
	async function stopScript({
		kind,
		workspaceId,
	}: StopScriptOptions): Promise<KillTerminalResult> {
		const activeSession = findActiveScriptSession(workspaceId, kind);

		if (!activeSession) {
			return {
				diagnostics: [
					{
						code: 'script-not-running',
						message: `No ${kind} script is currently running.`,
						severity: 'info',
					},
				],
				session: null,
			};
		}

		return {
			diagnostics: [],
			session: terminalService.kill(activeSession.id),
		};
	}

	return {
		runArchiveScriptAndWait: async ({
			timeoutMs = SCRIPT_EXIT_WAIT_TIMEOUT_MS,
			workspaceId,
		}) => {
			const result = await runScript({ kind: 'archive', workspaceId });
			const terminalId = result.session?.id;

			if (!terminalId) {
				return;
			}

			const exited = await terminalService.waitForExit(terminalId, timeoutMs);

			if (!exited) {
				// Archive must not hang forever behind a stuck script.
				terminalService.kill(terminalId);
			}
		},
		runScript,
		runSetupScriptIfNeeded,
		runSetupScriptWithAutoRun,
		stopScript,
	};
}

/** Builds a failed create-result with one diagnostic. */
function failure(
	code: string,
	message: string,
	severity: 'error' | 'info' | 'warning' = 'error',
): CreateTerminalSessionResult {
	return {
		diagnostics: [{ code, message, severity }],
		session: null,
	};
}

/** Default dock title per script kind. */
function defaultScriptTitle(kind: WorkspaceScriptKind): string {
	switch (kind) {
		case 'archive':
			return 'Archive';
		case 'run':
			return 'Run';
		case 'setup':
			return 'Setup';
	}
}

/** Type guard for the workspace join-row fields this service reads. */
function isWorkspaceRow(row: unknown): row is {
	metadataJson: string;
	path: string;
	repositoryId: string;
} {
	return (
		isRecord(row) &&
		isString(row.path) &&
		isString(row.repositoryId) &&
		isString(row.metadataJson)
	);
}
