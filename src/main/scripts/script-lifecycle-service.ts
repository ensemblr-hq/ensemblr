import type {
	CreateTerminalSessionResult,
	KillTerminalResult,
	TerminalSessionSnapshot,
} from '../../shared/ipc/contracts/terminal';
import type { WorkspaceScriptKind } from '../../shared/ipc/contracts/workspace-scripts';
import {
	formatRunScriptLabel,
	parseWorkspaceScriptSettings,
	type RunScriptDefinition,
	resolveRunScript,
	type WorkspaceScriptSettings,
} from '../../shared/scripts.ts';
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
	/**
	 * Which named run script to launch (`kind: 'run'` only). Omitted launches the
	 * repository's default; a name that is not configured fails rather than
	 * falling back, so a stale selection never runs the wrong command.
	 */
	scriptName?: string | null;
	workspaceId: string;
}

/** Inputs for {@link ScriptLifecycleService.stopScript}. */
export interface StopScriptOptions {
	kind: WorkspaceScriptKind;
	workspaceId: string;
}

/** One resolved script launch: everything needed to spawn its session. */
interface ScriptLaunch {
	command: string;
	kind: WorkspaceScriptKind;
	/** Repository the target workspace belongs to. */
	repositoryId: string;
	/** Configured run-script name, or null for setup/archive. */
	scriptName: string | null;
	/** True when `nonconcurrent` run mode must clear the repository's siblings first. */
	stopSiblingWorkspaces: boolean;
	title: string;
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
	 * workspaces.
	 * @param options - Script kind, target workspace, requested run script, and whether to restart.
	 * @returns The terminal session create result, or a typed failure diagnostic.
	 */
	async function runScript({
		kind,
		restart = false,
		scriptName,
		workspaceId,
	}: RunScriptOptions): Promise<CreateTerminalSessionResult> {
		const resolved = resolveScriptConfig(workspaceId);

		if (resolved.error) {
			return resolved.error;
		}

		const launch = resolveScriptLaunch({
			kind,
			repositoryId: resolved.repositoryId,
			requestedName: scriptName,
			settings: resolved.settings,
			workspaceId,
		});

		if (!launch) {
			return failure(
				'script-not-configured',
				describeMissingScript(kind, scriptName, resolved.settings.runScripts),
				'info',
			);
		}

		return runExclusiveScript(launch, restart);
	}

	/**
	 * Resolves which command a launch request runs, mapping the run kind onto one
	 * of the repository's named run scripts.
	 * @param options - Script kind, requested run-script name, resolved settings, and workspace.
	 * @returns The launch record, or null when nothing is configured for it.
	 */
	function resolveScriptLaunch({
		kind,
		repositoryId,
		requestedName,
		settings,
		workspaceId,
	}: {
		kind: WorkspaceScriptKind;
		repositoryId: string;
		requestedName: string | null | undefined;
		settings: WorkspaceScriptSettings;
		workspaceId: string;
	}): ScriptLaunch | null {
		if (kind !== 'run') {
			const command = settings.scripts[kind];

			return command
				? {
						command,
						kind,
						repositoryId,
						scriptName: null,
						stopSiblingWorkspaces: false,
						title: defaultScriptTitle(kind),
						workspaceId,
					}
				: null;
		}

		const runScript = resolveRunScript(settings.runScripts, requestedName);

		return runScript
			? {
					command: runScript.command,
					kind,
					repositoryId,
					scriptName: runScript.name,
					stopSiblingWorkspaces: settings.runScriptMode === 'nonconcurrent',
					title: formatRunScriptLabel(runScript.name),
					workspaceId,
				}
			: null;
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
		const activeSession = findActiveScriptSession(
			launch.workspaceId,
			launch.kind,
		);

		if (activeSession) {
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

			if (!exited) {
				return failure(
					'script-restart-timeout',
					`The running ${launch.kind} script did not stop in time; the restart was aborted.`,
					'warning',
					activeSession.id,
				);
			}
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
			fresh.settings.runScripts.length === 0
		) {
			return;
		}

		await runScript({ kind: 'run', workspaceId }).catch(() => {});
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
		listRunScripts: ({ workspaceId }) => {
			const resolved = resolveScriptConfig(workspaceId);

			return resolved.error ? [] : resolved.settings.runScripts;
		},
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

/**
 * Builds a failed create-result with one diagnostic.
 * @param code - Stable diagnostic code.
 * @param message - Human-readable reason no session started.
 * @param severity - How loudly the dock should report it.
 * @param terminalId - Session the refusal is about, when one already holds the slot.
 * @returns A session-less create result carrying that diagnostic.
 */
function failure(
	code: string,
	message: string,
	severity: 'error' | 'info' | 'warning' = 'error',
	terminalId?: string,
): CreateTerminalSessionResult {
	return {
		diagnostics: [
			{ code, message, severity, ...(terminalId && { terminalId }) },
		],
		session: null,
	};
}

/**
 * Lock a launch is serialized behind. Run launches lock on the repository, not
 * the workspace: `nonconcurrent` mode stops the launching workspace's siblings,
 * and it can only see a sibling whose session already exists. Two workspaces of
 * one repository starting at once would otherwise each find no sibling and both
 * survive, which is the port collision the mode exists to prevent. Setup and
 * archive stay per-workspace — they never reach outside their own worktree.
 * @param launch - The resolved launch.
 * @returns The key its start promise is held under.
 */
function exclusiveLaunchKey(launch: ScriptLaunch): string {
	return launch.kind === 'run'
		? `repository:${launch.repositoryId}:run`
		: `workspace:${launch.workspaceId}:${launch.kind}`;
}

/** Default dock title per script kind; named run scripts title themselves. */
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

/**
 * Explains why a launch found no command, distinguishing a repository with no
 * script of that kind from a request naming a run script that no longer exists.
 * A stale name is answered with the names that do exist, so an agent that
 * guessed can correct itself without a second round trip.
 * @param kind - The requested script kind.
 * @param scriptName - The requested run-script name, when one was given.
 * @param runScripts - The run scripts the repository actually configures.
 * @returns The diagnostic message.
 */
function describeMissingScript(
	kind: WorkspaceScriptKind,
	scriptName: string | null | undefined,
	runScripts: readonly RunScriptDefinition[],
): string {
	if (kind !== 'run' || !scriptName) {
		return `No ${kind} script is configured for this repository.`;
	}

	const configured = runScripts.map((script) => script.name).join(', ');

	return configured
		? `No run script named "${scriptName}" is configured for this repository. Configured run scripts: ${configured}.`
		: `No run script named "${scriptName}" is configured for this repository, which configures none at all.`;
}

/**
 * Explains which session already holds the workspace, naming the run script by
 * name. A caller that asked for one of several run scripts cannot otherwise tell
 * whether the session already up is the one it wanted or a different one it has
 * to stop first.
 * @param kind - The requested script kind.
 * @param activeScriptName - Name of the run script already running, when it has one.
 * @returns The diagnostic message.
 */
function describeRunningScript(
	kind: WorkspaceScriptKind,
	activeScriptName: string | null,
): string {
	const subject =
		kind === 'run' && activeScriptName
			? `The run script "${activeScriptName}"`
			: `The ${kind} script`;

	return `${subject} is already running. Stop it or restart explicitly.`;
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
