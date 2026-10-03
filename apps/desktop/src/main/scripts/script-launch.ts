import type { CreateTerminalSessionResult } from '../../shared/ipc/contracts/terminal';
import type { WorkspaceScriptKind } from '../../shared/ipc/contracts/workspace-scripts';
import {
	formatRunScriptLabel,
	type RunScriptDefinition,
	resolveRunScript,
	type WorkspaceScriptSettings,
} from '../../shared/scripts.ts';
import { isRecord, isString } from '../repository/row-guards.ts';

/** One resolved script launch: everything needed to spawn its session. */
export interface ScriptLaunch {
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

/**
 * Resolves which command a launch request runs, mapping the run kind onto one
 * of the repository's named run scripts.
 * @param options - Script kind, requested run-script name, resolved settings, and workspace.
 * @returns The launch record, or null when nothing is configured for it.
 */
export function resolveScriptLaunch({
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
 * Builds a failed create-result with one diagnostic.
 * @param code - Stable diagnostic code.
 * @param message - Human-readable reason no session started.
 * @param severity - How loudly the dock should report it.
 * @param terminalId - Session the refusal is about, when one already holds the slot.
 * @returns A session-less create result carrying that diagnostic.
 */
export function failure(
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
export function exclusiveLaunchKey(launch: ScriptLaunch): string {
	return launch.kind === 'run'
		? `repository:${launch.repositoryId}:run`
		: `workspace:${launch.workspaceId}:${launch.kind}`;
}

/**
 * Default dock title per script kind; named run scripts title themselves.
 * @param kind - The script kind.
 * @returns The English dock title.
 */
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
export function describeMissingScript(
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
export function describeRunningScript(
	kind: WorkspaceScriptKind,
	activeScriptName: string | null,
): string {
	const subject =
		kind === 'run' && activeScriptName
			? `The run script "${activeScriptName}"`
			: `The ${kind} script`;

	return `${subject} is already running. Stop it or restart explicitly.`;
}

/**
 * Type guard for the workspace join-row fields the script services read.
 * @param row - A row from the workspace-with-repository join.
 * @returns True when the row carries a path, repository id, and metadata.
 */
export function isWorkspaceRow(row: unknown): row is {
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
