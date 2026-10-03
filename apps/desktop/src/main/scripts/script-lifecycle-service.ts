import type { ComputeJobInitiator } from '../../shared/compute-queue.ts';
import type { ComputeQueueSettings } from '../../shared/config.ts';
import type {
	CreateTerminalSessionResult,
	KillTerminalResult,
	TerminalSessionSnapshot,
} from '../../shared/ipc/contracts/terminal';
import type { WorkspaceScriptKind } from '../../shared/ipc/contracts/workspace-scripts';
import {
	parseWorkspaceScriptSettings,
	type RunScriptDefinition,
	type WorkspaceScriptSettings,
} from '../../shared/scripts.ts';
import type { EnsemblrConfigResolutionService } from '../config';
import type { EnsemblrDatabaseService } from '../storage';
import { selectWorkspaceWithRepositoryById } from '../storage/repositories/workspace-repository.ts';
import type { TerminalService } from '../terminal';
import {
	asLaunchFailure,
	describeRunningScript,
	exclusiveLaunchKey,
	failure,
	isWorkspaceRow,
	launchFromConfig,
	type ResolvedLaunch,
	type ScriptLaunch,
	type ScriptLaunchRequest,
} from './script-launch.ts';
import {
	createScriptQueueGate,
	type ScriptComputeQueue,
	type ScriptLaunchStarter,
} from './script-queue-gate.ts';
import {
	isSetupFingerprintCurrent,
	recordSetupFingerprint,
} from './setup-state-file.ts';

const RESTART_WAIT_TIMEOUT_MS = 7_000;

/**
 * Longest the service waits for an archive script to exit before it gives up.
 * Archiving blocks on this wait, so it stays bounded. Setup deliberately has no
 * equivalent — see {@link finalizeSetup}.
 */
const ARCHIVE_EXIT_WAIT_TIMEOUT_MS = 60_000;

/** Inputs for {@link ScriptLifecycleService.runScript}. */
export interface RunScriptOptions {
	/**
	 * Who asked for the launch, which decides how a heavy script meets the
	 * compute queue: an `agent` or `auto` launch waits for a slot, a `user`
	 * launch starts at once and holds one. Defaults to `user`.
	 */
	initiator?: ComputeJobInitiator;
	kind: WorkspaceScriptKind;
	/** Stop the active session of this kind before starting a new one. */
	restart?: boolean;
	/**
	 * Which named run script to launch (`kind: 'run'` only). Omitted launches the
	 * repository's default; a name that is not configured fails rather than
	 * falling back, so a stale selection never runs the wrong command.
	 */
	scriptName?: string | null;
	/** Root of the requesting agent's delegation tree, for queue attribution. */
	rootSessionId?: string | null;
	/** Requesting agent session, so the queue can cancel the launch when it ends. */
	sessionId?: string | null;
	workspaceId: string;
}

/** Inputs for {@link ScriptLifecycleService.stopScript}. */
export interface StopScriptOptions {
	kind: WorkspaceScriptKind;
	workspaceId: string;
}

/** Public surface of the script lifecycle service. */
export interface ScriptLifecycleService {
	/**
	 * Run scripts the workspace's repository offers, in declaration order and
	 * already narrowed to the ones Ensemblr can launch locally. Empty when the
	 * workspace, its repository config, or SQLite cannot be read.
	 */
	listRunScripts: (options: {
		workspaceId: string;
	}) => readonly RunScriptDefinition[];
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
		/** Who asked; see {@link RunScriptOptions.initiator}. Defaults to `user`. */
		initiator?: ComputeJobInitiator;
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
	/**
	 * Stops the active script session of a kind and cancels any launch of that
	 * kind still waiting in the compute queue.
	 */
	stopScript: (options: StopScriptOptions) => Promise<KillTerminalResult>;
}

/** Options for {@link createScriptLifecycleService}. */
export interface CreateScriptLifecycleServiceOptions {
	/** The app-wide queue heavy setup and run scripts hold a slot in. */
	computeQueue: ScriptComputeQueue;
	databaseService: EnsemblrDatabaseService;
	/** Live compute-queue settings, read on every launch. */
	readComputeQueueSettings: () => ComputeQueueSettings;
	settingsResolutionService: EnsemblrConfigResolutionService;
	terminalService: TerminalService;
}

/**
 * Builds the service that runs repository setup/run/archive scripts inside
 * workspace PTY sessions: resolves the configured command per repository
 * config precedence, enforces the resolved `runScriptMode`, puts heavy
 * launches behind the compute queue, and exposes stop/restart controls.
 * Output streams through the terminal dock.
 * @param options - Service dependencies.
 * @returns A fresh {@link ScriptLifecycleService}.
 */
export function createScriptLifecycleService({
	computeQueue,
	databaseService,
	readComputeQueueSettings,
	settingsResolutionService,
	terminalService,
}: CreateScriptLifecycleServiceOptions): ScriptLifecycleService {
	const pendingExclusiveScriptStarts = new Map<
		string,
		Promise<CreateTerminalSessionResult>
	>();
	const queueGate = createScriptQueueGate({
		computeQueue,
		readComputeQueueSettings,
		terminalService,
	});

	/**
	 * Resolves the configured command and run mode from the workspace worktree,
	 * along with the repository the workspace belongs to — which run launches
	 * need to serialize and to reach the workspace's siblings.
	 */
	function resolveScriptConfig(workspaceId: string):
		| { error: CreateTerminalSessionResult; repositoryId: null; settings: null }
		| {
				error: null;
				repositoryId: string;
				settings: WorkspaceScriptSettings;
		  } {
		const database = databaseService.getConnection()?.database ?? null;

		if (!database) {
			return {
				error: failure(
					'database-unavailable',
					'SQLite is unavailable; the script cannot be resolved.',
				),
				repositoryId: null,
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
				repositoryId: null,
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
			repositoryId: row.repositoryId,
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
	 * Start a workspace's setup/run/archive script session. Only one script of a
	 * kind runs per workspace at a time, so launches are serialized and a second
	 * request is refused unless it asks for a restart. In `nonconcurrent` run
	 * mode a run launch additionally stops run scripts in the repository's other
	 * workspaces. A launch that has to wait for a compute slot answers at once
	 * with its queued job and starts once the slot is granted.
	 * @param options - Script kind, target workspace, requested run script, whether to restart, and who asked.
	 * @returns The terminal session create result, a queued job, or a typed failure diagnostic.
	 */
	function runScript(
		options: RunScriptOptions,
	): Promise<CreateTerminalSessionResult> {
		return startScript(options);
	}

	/**
	 * Resolves the launch a request names from the repository's current script
	 * settings.
	 * @param request - Script kind, requested run-script name, and target workspace.
	 * @returns The launch, or the failure that stops it.
	 */
	function resolveLaunch(request: ScriptLaunchRequest): ResolvedLaunch {
		return launchFromConfig(resolveScriptConfig(request.workspaceId), request);
	}

	/**
	 * Resolves a launch and starts it, through the compute queue when it is heavy.
	 * A conflict or a restart is settled before the launch queues, so a waiting
	 * launch never sits behind the very session it was asked to replace. A launch
	 * that waited re-reads its command from the current settings when its slot
	 * comes, starts without a restart (the one it asked for already happened),
	 * and fails its job when the script is no longer configured.
	 * @param options - The launch request.
	 * @param onSessionStarted - Called with the session id whenever the launch opens one, now or after a queue wait.
	 * @returns The terminal session create result, a queued job, or a typed failure diagnostic.
	 */
	async function startScript(
		{
			initiator = 'user',
			kind,
			restart = false,
			rootSessionId,
			scriptName,
			sessionId,
			workspaceId,
		}: RunScriptOptions,
		onSessionStarted?: (terminalId: string) => void,
	): Promise<CreateTerminalSessionResult> {
		const request = { kind, scriptName, workspaceId };
		const { failure: unresolved, launch } = resolveLaunch(request);

		if (unresolved) {
			return unresolved;
		}

		/**
		 * Performs the launch once it may start. One that waited re-reads its
		 * script, fails when it is gone, reports a changed command to its job,
		 * and never restarts: the restart it asked for happened before it queued.
		 * @param options - Whether it waited, and where to report its command.
		 * @returns The terminal session create result or a typed failure.
		 */
		const start: ScriptLaunchStarter = async ({ deferred, describe }) => {
			const current = deferred ? resolveLaunch(request) : { launch };

			if (!current.launch) {
				return asLaunchFailure(current.failure);
			}

			if (current.launch.command !== launch.command) {
				describe?.(current.launch.command);
			}

			const result = await runExclusiveScript(
				current.launch,
				deferred ? false : restart,
			);

			if (result.session) {
				onSessionStarted?.(result.session.id);
			}

			return result;
		};

		if (!queueGate.requiresSlot(launch)) {
			return start({ deferred: false });
		}

		const blocked = hasActiveSession(launch)
			? await clearActiveSession(launch, restart)
			: null;

		if (blocked) {
			return blocked;
		}

		return queueGate.admit({
			launch,
			owner: { initiator, rootSessionId, sessionId },
			start,
		});
	}

	/**
	 * Serializes a script launch behind any in-flight launch sharing its lock.
	 * The pending promise spans the entire decision — active-session check,
	 * restart kill/wait, sibling stop, and session create — so a concurrent
	 * request always observes the first launch's session before it decides,
	 * closing the duplicate-session race for both fresh starts and restarts.
	 * @param launch - The resolved launch.
	 * @param restart - Whether to replace a session that is already running.
	 * @returns The terminal session create result, or a typed failure diagnostic.
	 */
	async function runExclusiveScript(
		launch: ScriptLaunch,
		restart: boolean,
	): Promise<CreateTerminalSessionResult> {
		const key = exclusiveLaunchKey(launch);
		const pendingStart = pendingExclusiveScriptStarts.get(key);

		if (pendingStart) {
			await pendingStart.catch(() => undefined);
		}

		const started = launchExclusiveScript(launch, restart);
		pendingExclusiveScriptStarts.set(key, started);

		try {
			return await started;
		} finally {
			if (pendingExclusiveScriptStarts.get(key) === started) {
				pendingExclusiveScriptStarts.delete(key);
			}
		}
	}

	/**
	 * Reports whether a session of the launch's kind is running in its workspace.
	 * Checked before {@link clearActiveSession} so a launch with nothing to clear
	 * reaches its spawn without yielding, which keeps concurrent requests ordered.
	 * @param launch - The resolved launch.
	 * @returns True when a session would block or be replaced.
	 */
	function hasActiveSession(launch: ScriptLaunch): boolean {
		return findActiveScriptSession(launch.workspaceId, launch.kind) !== null;
	}

	/**
	 * Clears the way for a launch: refuses when a session of its kind is already
	 * running, unless restart is set, in which case it stops that session and
	 * waits for it to exit.
	 * @param launch - The resolved launch.
	 * @param restart - Whether to replace a session that is already running.
	 * @returns A failure that blocks the launch, or null when it may proceed.
	 */
	async function clearActiveSession(
		launch: ScriptLaunch,
		restart: boolean,
	): Promise<CreateTerminalSessionResult | null> {
		const activeSession = findActiveScriptSession(
			launch.workspaceId,
			launch.kind,
		);

		if (!activeSession) {
			return null;
		}

		if (!restart) {
			return failure(
				'script-already-running',
				describeRunningScript(launch.kind, activeSession.scriptName),
				'warning',
				activeSession.id,
			);
		}

		terminalService.kill(activeSession.id);
		const exited = await terminalService.waitForExit(
			activeSession.id,
			RESTART_WAIT_TIMEOUT_MS,
		);

		return exited
			? null
			: failure(
					'script-restart-timeout',
					`The running ${launch.kind} script did not stop in time; the restart was aborted.`,
					'warning',
					activeSession.id,
				);
	}

	/**
	 * Decides and performs one exclusive launch: fails when a session is already
	 * running unless restart is set, in which case it stops the active session
	 * and waits for it to exit before starting the replacement.
	 * @param launch - The resolved launch.
	 * @param restart - Whether to replace a session that is already running.
	 * @returns The terminal session create result, or a typed failure diagnostic.
	 */
	async function launchExclusiveScript(
		launch: ScriptLaunch,
		restart: boolean,
	): Promise<CreateTerminalSessionResult> {
		const blocked = hasActiveSession(launch)
			? await clearActiveSession(launch, restart)
			: null;

		if (blocked) {
			return blocked;
		}

		if (launch.stopSiblingWorkspaces) {
			await stopSiblingWorkspaceRunScripts(launch);
		}

		return createScriptSession(launch);
	}

	/**
	 * Stops run scripts running in the repository's other workspaces, which is
	 * what `nonconcurrent` run mode means: one workspace of a repository holds
	 * the dev server at a time. Best-effort — a sibling that ignores the kill is
	 * left behind rather than blocking this workspace's launch. Siblings stop
	 * together, so one that has to be waited out does not delay the rest.
	 * @param launch - The run launch about to start.
	 */
	async function stopSiblingWorkspaceRunScripts(
		launch: ScriptLaunch,
	): Promise<void> {
		await Promise.all(
			findSiblingRunSessionIds(launch).map((sessionId) => {
				terminalService.kill(sessionId);

				return terminalService.waitForExit(sessionId, RESTART_WAIT_TIMEOUT_MS);
			}),
		);
	}

	/**
	 * Live run-script sessions belonging to the repository's other workspaces.
	 * @param launch - The run launch about to start.
	 * @returns The sibling session ids, or none when SQLite is unavailable.
	 */
	function findSiblingRunSessionIds(launch: ScriptLaunch): string[] {
		const database = databaseService.getConnection()?.database ?? null;

		if (!database) {
			return [];
		}

		const sharesRepository = (sessionWorkspaceId: string): boolean => {
			const sibling = selectWorkspaceWithRepositoryById({
				database,
				workspaceId: sessionWorkspaceId,
			});

			return (
				isWorkspaceRow(sibling) && sibling.repositoryId === launch.repositoryId
			);
		};

		const siblingSessionIds: string[] = [];
		for (const session of terminalService.listByKind('run-script')) {
			if (
				session.workspaceId !== launch.workspaceId &&
				session.status === 'running' &&
				sharesRepository(session.workspaceId)
			) {
				siblingSessionIds.push(session.id);
			}
		}

		return siblingSessionIds;
	}

	/**
	 * Creates a workspace terminal session for a resolved launch, applying the
	 * `<kind>-script` session kind, dock title, and run-script name.
	 * @param launch - The resolved launch.
	 * @returns The terminal session create result.
	 */
	function createScriptSession(
		launch: ScriptLaunch,
	): Promise<CreateTerminalSessionResult> {
		return terminalService.create({
			command: launch.command,
			kind: `${launch.kind}-script`,
			title: launch.title,
			workspaceId: launch.workspaceId,
			...(launch.scriptName ? { scriptName: launch.scriptName } : {}),
		});
	}

	/**
	 * Waits for a setup session to finish and, when it exits cleanly, records the
	 * dependency fingerprint so later opens can skip setup, then chains the run
	 * script if the repository enables `autoRunAfterSetup`. Setup failures and
	 * mid-flight stops skip both the record and the chain. Settings are re-read
	 * after the wait so a mid-setup opt-out is honored.
	 *
	 * The wait is deliberately unbounded. A bounded one abandoned any setup
	 * slower than its timeout — a cold `npm install` routinely is — so the
	 * fingerprint was never written and every later open re-ran setup, which read
	 * as setup firing at random.
	 *
	 * Nothing the user waits on waits on this. `runSetupScriptIfNeeded` launches
	 * it without awaiting, and `runSetupScriptWithAutoRun` — which does await it —
	 * is itself only ever fired and forgotten, by the create hook in
	 * `script-hooks.ts`. So an unbounded wait costs a pending promise rather than
	 * a stalled caller, which matters because two cases never resolve one:
	 * a session removed from the service while still running loses its waiter
	 * list with it, and quit replaces each exit subscription before signalling the
	 * PTY, so `finalizeSession` — the only place waiters are drained — does not
	 * run for a setup still going when the app closes. Both cost at most one
	 * redundant setup run on the next open.
	 * @param options - The setup command, who started it, its session id, and the target workspace.
	 */
	async function finalizeSetup({
		command,
		initiator,
		sessionId,
		workspaceId,
	}: {
		command: string;
		initiator: ComputeJobInitiator;
		sessionId: string;
		workspaceId: string;
	}): Promise<void> {
		await terminalService.waitForExit(sessionId);

		if (terminalService.getSnapshot(sessionId).session?.status !== 'exited') {
			return;
		}

		recordSetupCompletion({ command, workspaceId });

		const fresh = resolveScriptConfig(workspaceId);

		if (
			fresh.error ||
			!fresh.settings.autoRunAfterSetup ||
			fresh.settings.runScripts.length === 0
		) {
			return;
		}

		await runScript({ initiator, kind: 'run', workspaceId }).catch(() => {});
	}

	/**
	 * Persists the current setup fingerprint to the worktree's
	 * `.context/setup.local.json` marker. Best-effort: silently no-ops when
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

		recordSetupFingerprint(row.path, command);
	}

	/**
	 * Runs the setup script, then records its fingerprint and chains the run
	 * script per `autoRunAfterSetup` once it exits cleanly. Awaits the full tail,
	 * so a caller that awaits this awaits the setup session itself: since
	 * {@link finalizeSetup} waits for that exit without a bound, the returned
	 * promise settles when setup does and not before. Call it without awaiting
	 * unless blocking for the whole of setup is the intent. The app starts it on
	 * its own, so setup waits for a compute slot; a setup that has to wait
	 * settles this at once and finalizes in the background once it runs.
	 */
	async function runSetupScriptWithAutoRun({
		workspaceId,
	}: {
		workspaceId: string;
	}): Promise<void> {
		const resolved = resolveScriptConfig(workspaceId);
		const command = resolved.error ? null : resolved.settings.scripts.setup;

		if (!command) {
			return;
		}

		let finalized: Promise<void> | undefined;
		await startScript(
			{ initiator: 'auto', kind: 'setup', workspaceId },
			(sessionId) => {
				finalized = finalizeSetup({
					command,
					initiator: 'auto',
					sessionId,
					workspaceId,
				}).catch((error: unknown) => {
					console.warn(
						`[scripts] could not finalize setup in workspace ${workspaceId}`,
						error,
					);
				});
			},
		);
		await finalized;
	}

	/**
	 * Runs the setup script only when the workspace's current dependency
	 * fingerprint differs from the last recorded successful run. A match returns
	 * an info diagnostic without starting a session; otherwise setup starts and
	 * its fingerprint is recorded in the background once it exits cleanly.
	 * @param options - The target workspace and who asked.
	 * @returns The launched setup session result, its queued job, an info
	 *   diagnostic when setup is already current, or a typed failure.
	 */
	async function runSetupScriptIfNeeded({
		initiator = 'user',
		workspaceId,
	}: {
		initiator?: ComputeJobInitiator;
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

		if (isSetupFingerprintCurrent(row.path, command)) {
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

		return startScript(
			{ initiator, kind: 'setup', workspaceId },
			(sessionId) => {
				void finalizeSetup({ command, initiator, sessionId, workspaceId });
			},
		);
	}

	/**
	 * Stop the active script session of a given kind for a workspace, and cancel
	 * any launch of that kind still waiting in the compute queue.
	 * @param options - Script kind and target workspace
	 * @returns The kill result, or an info diagnostic when no session is running
	 */
	async function stopScript({
		kind,
		workspaceId,
	}: StopScriptOptions): Promise<KillTerminalResult> {
		const cancelledQueued = queueGate.cancelQueued(workspaceId, kind);
		const activeSession = findActiveScriptSession(workspaceId, kind);

		if (!activeSession) {
			return {
				diagnostics: [
					cancelledQueued
						? {
								code: 'script-queue-cancelled',
								message: `The queued ${kind} script was cancelled before it started.`,
								severity: 'info',
							}
						: {
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
		listRunScripts: ({ workspaceId }) => {
			const resolved = resolveScriptConfig(workspaceId);

			return resolved.error ? [] : resolved.settings.runScripts;
		},
		runArchiveScriptAndWait: async ({
			timeoutMs = ARCHIVE_EXIT_WAIT_TIMEOUT_MS,
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
