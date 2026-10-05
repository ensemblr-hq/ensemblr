import type {
	DockTabStatus,
	WorkspaceScriptQueuedJob,
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

/**
 * Builds the setup and run script summaries for the dock panels.
 * @param options - Live terminal sessions, resolved script settings, and the workspace's script launches waiting in the compute queue, first in line first.
 * @returns The setup and run summaries.
 */
export function buildWorkspaceScriptSummaries({
	queuedJobs = [],
	sessions,
	settings,
}: {
	queuedJobs?: readonly WorkspaceScriptQueuedJob[];
	sessions: readonly TerminalSessionSnapshot[];
	settings: WorkspaceScriptSettings | null;
}): { run: WorkspaceScriptSummary; setup: WorkspaceScriptSummary } {
	return {
		run: buildScriptSummary({ kind: 'run', queuedJobs, sessions, settings }),
		setup: buildScriptSummary({
			kind: 'setup',
			queuedJobs,
			sessions,
			settings,
		}),
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

/**
 * Maps a script summary to the dock tab activity state. A script blocked on a
 * password prompt reads as a warning, so the tab asks for attention while the
 * dock is showing something else; a launch waiting for a compute slot reads as
 * queued, so the tab says the script is coming rather than idle.
 * @param summary - The script's dock summary.
 * @returns The tab's activity state.
 */
export function scriptSummaryToDockStatus(
	summary: WorkspaceScriptSummary,
): DockTabStatus {
	if (summary.secretPrompt) {
		return 'warning';
	}

	if (summary.status === 'running') {
		return 'running';
	}

	if (summary.queuedJob) {
		return 'queued';
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
 * Folds a script's resolved command, its latest terminal session, and any
 * launch of it waiting in the compute queue into a single dock summary,
 * carrying any auto-detected preview URL and port.
 * @param options - The script kind, its queued launches, live terminal sessions, and resolved script settings
 * @returns The summary describing the script's command, status, queued launch, and preview
 */
function buildScriptSummary({
	kind,
	queuedJobs,
	sessions,
	settings,
}: {
	kind: WorkspaceScriptKind;
	queuedJobs: readonly WorkspaceScriptQueuedJob[];
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
		...queuedJobFields(kind, queuedJobs, sessions),
		...secretPromptFields(latestSession),
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
 * Carries the first launch of this script still waiting for a compute slot onto
 * the summary. A running session of the same kind is what the dock is showing,
 * and the queued panel's Cancel stops whatever of that kind is running, so a
 * launch queued behind a live session never displaces it.
 * @param kind - The script kind.
 * @param queuedJobs - The workspace's queued script launches, first in line first.
 * @param sessions - Every live terminal session in the workspace.
 * @returns The queued-job field to spread onto the summary, absent when nothing waits.
 */
function queuedJobFields(
	kind: WorkspaceScriptKind,
	queuedJobs: readonly WorkspaceScriptQueuedJob[],
	sessions: readonly TerminalSessionSnapshot[],
): Pick<WorkspaceScriptSummary, 'queuedJob'> {
	const hasRunningSession = sessions.some(
		(session) =>
			session.kind === `${kind}-script` && session.status === 'running',
	);

	if (hasRunningSession) {
		return {};
	}

	const queuedJob = queuedJobs.find((job) => job.kind === kind);

	return queuedJob ? { queuedJob } : {};
}

/**
 * Carries the password prompt a running script is blocked on onto the summary.
 * A session that has ended is no longer reading anything, so a stale prompt
 * never outlives it.
 * @param session - The latest script session, when one exists.
 * @returns The prompt field to spread onto the summary, absent when nothing is waiting.
 */
function secretPromptFields(
	session: TerminalSessionSnapshot | undefined,
): Pick<WorkspaceScriptSummary, 'secretPrompt'> {
	return session?.status === 'running' && session.secretPrompt
		? { secretPrompt: session.secretPrompt }
		: {};
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
