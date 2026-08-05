import type {
	DockTabStatus,
	WorkspaceRunTargetSummary,
	WorkspaceScriptSummary,
} from '@/renderer/types/workbench';
import type { TerminalSessionSnapshot } from '@/shared/ipc/contracts/terminal';
import { DEFAULT_RUN_TARGET_ID, type WorkspaceScriptSettings } from '@/shared/scripts';
import { extractPreviewPort } from '@/shared/terminal';

/**
 * Pure helpers that fold resolved repository script settings and live terminal
 * sessions into the dock's setup/run script summaries.
 */

/**
 * Builds the setup summary and one run summary per configured run target
 * (ADR 0041) for the dock panels. A configured-but-never-run target still
 * gets a `not-run` summary, so its dock tab exists before it is first started.
 */
export function buildWorkspaceScriptSummaries({
	sessions,
	settings,
}: {
	sessions: readonly TerminalSessionSnapshot[];
	settings: WorkspaceScriptSettings | null;
}): { runTargets: WorkspaceRunTargetSummary[]; setup: WorkspaceScriptSummary } {
	const configuredTargets = settings?.runTargets ?? [];

	return {
		// A workspace with no configured run target still gets one dock tab (the
		// "No run script configured" empty state, with its Setup Scripts CTA, stays
		// discoverable) — mirroring the always-present Setup tab.
		runTargets:
			configuredTargets.length > 0
				? configuredTargets.map((target) => {
						const latestSession = sessions.findLast(
							(session) =>
								session.kind === 'run-script' &&
								session.runTargetId === target.id,
						);

						return {
							...sessionStatusFields(latestSession),
							command: target.command,
							id: target.id,
							name: target.name,
						};
					})
				: [{ id: MISSING_RUN_TARGET_ID, name: '', status: 'missing' as const }],
		setup: buildSetupSummary({ sessions, settings }),
	};
}

/**
 * Dock-tab id for the single placeholder run target shown when none is
 * configured. Deliberately equal to {@link DEFAULT_RUN_TARGET_ID} so the
 * placeholder tab and a legacy single-string target share the same `run:*`
 * id — the tab stays put when an unconfigured workspace gains its first target.
 */
export const MISSING_RUN_TARGET_ID = DEFAULT_RUN_TARGET_ID;

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
 * Folds the setup script's resolved command and its latest terminal session
 * into a dock summary; `missing` when neither a command nor a session exists.
 * @param options - Live terminal sessions and resolved script settings.
 * @returns The summary describing setup's command, status, and preview.
 */
function buildSetupSummary({
	sessions,
	settings,
}: {
	sessions: readonly TerminalSessionSnapshot[];
	settings: WorkspaceScriptSettings | null;
}): WorkspaceScriptSummary {
	const command = settings?.scripts.setup;
	const latestSession = sessions.findLast(
		(session) => session.kind === 'setup-script',
	);

	if (!command && !latestSession) {
		return { status: 'missing' };
	}

	return {
		...sessionStatusFields(latestSession),
		...(command ? { command } : {}),
	};
}

/**
 * Folds a session's live terminal status into the shared summary fields:
 * preview URL/port (auto-detected from run-script output), terminal id, and
 * the coarse `status` the dock renders. Carries no `command` — callers stamp
 * that on separately since its source differs between setup (settings) and a
 * run target (already known to the caller).
 * @param latestSession - The most recent matching terminal session, if any.
 * @returns The status/preview/terminal-id fields common to every summary.
 */
function sessionStatusFields(
	latestSession: TerminalSessionSnapshot | undefined,
): Omit<WorkspaceScriptSummary, 'command'> {
	// The main process auto-detects a dev-server URL from run-script output and
	// stamps it on the session; carry it (and its port) onto the summary so the
	// dock can render the Open button.
	const previewUrl = latestSession?.previewUrl ?? null;
	const previewPort = previewUrl ? extractPreviewPort(previewUrl) : null;

	const base: Omit<WorkspaceScriptSummary, 'command'> = {
		...(previewUrl ? { previewUrl } : {}),
		...(previewPort !== null ? { port: previewPort } : {}),
		sessionStatus: latestSession?.status ?? null,
		status: 'not-run',
		terminalId: latestSession?.id ?? null,
	};

	if (!latestSession) {
		return base;
	}

	switch (latestSession.status) {
		case 'running':
			return { ...base, status: 'running' };
		case 'exited':
			return { ...base, status: 'succeeded' };
		case 'failed':
		case 'stopped':
			return { ...base, status: 'stopped' };
	}
}
