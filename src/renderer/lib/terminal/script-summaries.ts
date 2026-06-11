import type {
	DockTabStatus,
	WorkspaceScriptSummary,
} from '@/renderer/types/workbench';
import type {
	TerminalSessionSnapshot,
	WorkspaceScriptKind,
} from '@/shared/ipc';
import type { WorkspaceScriptSettings } from '@/shared/scripts/script-settings';

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

	const base: WorkspaceScriptSummary = {
		...(command ? { command } : {}),
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
