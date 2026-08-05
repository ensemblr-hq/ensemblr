import type {
	DockTabStatus,
	WorkspaceScriptSummary,
} from '@/renderer/types/workbench';
import type { TerminalSessionSnapshot } from '@/shared/ipc/contracts/terminal';
import type { WorkspaceScriptKind } from '@/shared/ipc/contracts/workspace-scripts';
import {
	type RunScriptDefinition,
	resolveRunScript,
	selectDefaultRunScript,
	type WorkspaceScriptSettings,
} from '@/shared/scripts';
import { extractPreviewPort } from '@/shared/terminal';

/**
 * Pure helpers that fold resolved repository script settings and live terminal
 * sessions into the dock's setup/run script summaries.
 */

/**
 * Reads the command a script kind is configured with. The run kind has no
 * single command — its summary reports the default of the named run scripts, so
 * the dock can tell "nothing configured" from "configured but never started".
 * @param kind - The script kind.
 * @param settings - Resolved repository script settings.
 * @returns The command, or undefined when the kind is unconfigured.
 */
function resolveConfiguredCommand(
	kind: WorkspaceScriptKind,
	settings: WorkspaceScriptSettings | null,
): string | undefined {
	if (kind !== 'run') {
		return settings?.scripts[kind];
	}

	return selectDefaultRunScript(settings?.runScripts ?? [])?.command;
}

/** Builds the setup and run script summaries for the dock panels. */
export function buildWorkspaceScriptSummaries({
	sessions,
	settings,
}: {
	sessions: readonly TerminalSessionSnapshot[];
	settings: WorkspaceScriptSettings | null;
}): { run: WorkspaceScriptSummary; setup: WorkspaceScriptSummary } {
	return {
		run: buildScriptSummary({ kind: 'run', sessions, settings }),
		setup: buildScriptSummary({ kind: 'setup', sessions, settings }),
	};
}

/**
 * Picks the run script the dock's Run button targets: whatever is running wins,
 * then the workspace's remembered pick, then the repository's default. Keeping
 * the running session first means the Stop button and ⌘R always act on the
 * script the user is actually watching.
 * @param options - Configured run scripts, the live run summary, and the remembered name.
 * @returns The active run script, or null when none are configured.
 */
export function selectActiveRunScript({
	rememberedName,
	runScripts,
	runSummary,
}: {
	rememberedName: string | null;
	runScripts: readonly RunScriptDefinition[];
	runSummary: WorkspaceScriptSummary;
}): RunScriptDefinition | null {
	const runningName =
		runSummary.status === 'running' ? (runSummary.scriptName ?? null) : null;

	return (
		(runningName ? resolveRunScript(runScripts, runningName) : null) ??
		(rememberedName ? resolveRunScript(runScripts, rememberedName) : null) ??
		selectDefaultRunScript(runScripts)
	);
}

/** Maps a script summary to the dock tab activity state. */
export function scriptSummaryToDockStatus(
	summary: WorkspaceScriptSummary,
): DockTabStatus {
	if (summary.status === 'running') {
		return 'running';
	}

	if (summary.sessionStatus === 'failed') {
		return 'warning';
	}

	if (summary.status === 'succeeded') {
		return 'ready';
	}

	return 'idle';
}

/**
 * Folds a script's resolved command and its latest terminal session into a
 * single dock summary, carrying any auto-detected preview URL and port.
 * @param options - The script kind, live terminal sessions, and resolved script settings
 * @returns The summary describing the script's command, status, and preview
 */
function buildScriptSummary({
	kind,
	sessions,
	settings,
}: {
	kind: WorkspaceScriptKind;
	sessions: readonly TerminalSessionSnapshot[];
	settings: WorkspaceScriptSettings | null;
}): WorkspaceScriptSummary {
	const command = resolveConfiguredCommand(kind, settings);
	const latestSession = sessions.findLast(
		(session) => session.kind === `${kind}-script`,
	);

	if (!command && !latestSession) {
		return { status: 'missing' };
	}

	return {
		...(command ? { command } : {}),
		...previewFields(latestSession),
		scriptName: latestSession?.scriptName ?? null,
		sessionStatus: latestSession?.status ?? null,
		status: latestSession ? summaryStatus(latestSession.status) : 'not-run',
		terminalId: latestSession?.id ?? null,
	};
}

/**
 * Carries a session's auto-detected dev-server URL (and its port) onto the
 * summary. The main process stamps the URL on `run-script` sessions as it scans
 * their output; both fields stay absent until one is seen.
 * @param session - The latest script session, when one exists.
 * @returns The preview fields to spread onto the summary.
 */
function previewFields(
	session: TerminalSessionSnapshot | undefined,
): Pick<WorkspaceScriptSummary, 'port' | 'previewUrl'> {
	const previewUrl = session?.previewUrl ?? null;

	if (!previewUrl) {
		return {};
	}

	const port = extractPreviewPort(previewUrl);

	return { previewUrl, ...(port !== null ? { port } : {}) };
}

/**
 * Maps a terminal session's lifecycle state onto the dock's script status.
 * @param status - The session's status.
 * @returns The matching summary status.
 */
function summaryStatus(
	status: TerminalSessionSnapshot['status'],
): WorkspaceScriptSummary['status'] {
	switch (status) {
		case 'running':
			return 'running';
		case 'exited':
			return 'succeeded';
		case 'failed':
		case 'stopped':
			return 'stopped';
	}
}
