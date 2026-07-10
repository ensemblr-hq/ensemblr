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
import type { EnsemblrConfigResolutionService } from '../config/config-resolution';
import { isRecord, isString } from '../repository/row-guards.ts';
import type { EnsemblrDatabaseService } from '../storage/database.ts';
import { selectWorkspaceWithRepositoryById } from '../storage/repositories/workspace-repository.ts';
import type { TerminalService } from '../terminal';

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
	 * Runs the setup script and, when the repository has `autoRunAfterSetup`
	 * enabled and the setup exits successfully, chains the run script.
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
	/** Resolves the configured command and run mode for a workspace's repository. */
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

		if (!isWorkspaceJoinRow(row)) {
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
				repositoryPath: row.repositoryPath,
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

		const activeSession = findActiveScriptSession(workspaceId, kind);

		if (activeSession) {
			// Run scripts honor the resolved concurrency mode; setup and archive
			// scripts never run twice in parallel.
			const allowConcurrent =
				kind === 'run' &&
				resolved.settings.runScriptMode === 'concurrent' &&
				!restart;

			if (allowConcurrent) {
				// Fall through and start another named run session.
			} else if (restart) {
				terminalService.kill(activeSession.id);
				const exited = await terminalService.waitForExit(
					activeSession.id,
					RESTART_WAIT_TIMEOUT_MS,
				);

				if (!exited) {
					// Never stack a second session over one that refused to die.
					return failure(
						'script-restart-timeout',
						`The running ${kind} script did not stop in time; the restart was aborted.`,
						'warning',
					);
				}
			} else {
				return failure(
					'script-already-running',
					`The ${kind} script is already running. Stop it or restart explicitly.`,
					'warning',
				);
			}
		}

		return terminalService.create({
			command,
			kind: `${kind}-script`,
			title: defaultScriptTitle(kind),
			workspaceId,
		});
	}

	/**
	 * Runs the setup script for a workspace, then auto-starts the run script when
	 * the repository opts in via `autoRunAfterSetup` and the setup exits cleanly.
	 * Waits for the setup session to finish only when auto-run is enabled, so the
	 * common (opt-out) path stays fire-and-forget. The wait is bounded and the
	 * settings are re-read afterward, so a hung setup or a mid-setup opt-out both
	 * skip the chain.
	 */
	async function runSetupScriptWithAutoRun({
		workspaceId,
	}: {
		workspaceId: string;
	}): Promise<void> {
		const setupResult = await runScript({ kind: 'setup', workspaceId });
		const setupSessionId = setupResult.session?.id;

		if (!setupSessionId) {
			return;
		}

		// Cheap short-circuit: skip the wait entirely when the pre-wait snapshot
		// already shows auto-run is off or no run command is configured.
		const preWait = resolveScriptConfig(workspaceId);

		if (
			preWait.error ||
			!preWait.settings.autoRunAfterSetup ||
			!preWait.settings.scripts.run
		) {
			return;
		}

		// Bound the wait so a hung setup script cannot block the chain forever.
		const exited = await terminalService.waitForExit(
			setupSessionId,
			SCRIPT_EXIT_WAIT_TIMEOUT_MS,
		);

		// Skip the chain when setup timed out or did not finish cleanly (exit 0).
		if (
			!exited ||
			terminalService.getSnapshot(setupSessionId).session?.status !== 'exited'
		) {
			return;
		}

		// Re-read settings after the wait: the user may have toggled auto-run off
		// or cleared the run command while a long setup script ran.
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

/** Type guard for the workspace + repository join row. */
function isWorkspaceJoinRow(row: unknown): row is {
	repositoryId: string;
	repositoryPath: string;
} {
	return (
		isRecord(row) && isString(row.repositoryId) && isString(row.repositoryPath)
	);
}
