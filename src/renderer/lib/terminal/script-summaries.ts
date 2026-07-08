import type {
	DockTabStatus,
	WorkspaceScriptSummary,
} from '@/renderer/types/workbench';
import type { TerminalSessionSnapshot } from '@/shared/ipc/contracts/terminal';
import type { WorkspaceScriptKind } from '@/shared/ipc/contracts/workspace-scripts';
import type { WorkspaceScriptSettings } from '@/shared/scripts/script-settings';
import { extractPreviewPort } from '@/shared/terminal/detect-preview-url';

/**
 * Pure helpers that fold resolved repository script settings and live terminal
 * sessions into the dock's setup/run script summaries.
 */

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

/** Maps a script summary to the dock tab status badge. */
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

function buildScriptSummary({
	kind,
	sessions,
	settings,
}: {
	kind: WorkspaceScriptKind;
	sessions: readonly TerminalSessionSnapshot[];
	settings: WorkspaceScriptSettings | null;
}): WorkspaceScriptSummary {
	const command = settings?.scripts[kind];
	const latestSession = sessions.findLast(
		(session) => session.kind === `${kind}-script`,
	);

	if (!command && !latestSession) {
		return { status: 'missing' };
	}

	// The main process auto-detects a dev-server URL from run-script output and
	// stamps it on the session; carry it (and its port) onto the summary so the
	// dock can render the Open button.
	const previewUrl = latestSession?.previewUrl ?? null;
	const previewPort = previewUrl ? extractPreviewPort(previewUrl) : null;

	const base: WorkspaceScriptSummary = {
		...(command ? { command } : {}),
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
