import type {
	DockTabStatus,
	TerminalDockTabModel,
} from '@/renderer/types/workbench';
import type {
	TerminalSessionSnapshot,
	TerminalSessionStatus,
} from '@/shared/ipc/contracts/terminal';

/**
 * Pure helpers that derive dock terminal tabs from live terminal sessions and
 * fold lifecycle broadcasts into renderer state.
 */

/** Maps a terminal session status to the dock tab status badge. */
export function terminalSessionToDockStatus(
	status: TerminalSessionStatus,
): DockTabStatus {
	switch (status) {
		case 'failed':
			return 'warning';
		case 'running':
			return 'running';
		case 'exited':
		case 'stopped':
			return 'idle';
	}
}

/**
 * Builds the terminal dock tabs for the live interactive sessions of one
 * workspace. Script-kind sessions render in the fixed Setup/Run tabs and are
 * excluded here. With no interactive session the dock shows only Setup/Run and
 * the `+` button — an empty list is returned.
 * @param sessions - Live terminal sessions for the workspace.
 * @returns The terminal dock tabs (empty when no interactive session exists).
 */
export function mapTerminalSessionsToDockTabs(
	sessions: readonly TerminalSessionSnapshot[],
): TerminalDockTabModel[] {
	return sessions
		.filter((session) => session.kind === 'terminal')
		.map((session) => ({
			id: `terminal:${session.id}` as const,
			kind: 'terminal',
			label: session.title,
			sessionStatus: session.status,
			status: terminalSessionToDockStatus(session.status),
			terminalId: session.id,
		}));
}

/**
 * Returns a new session list with `session` inserted or replacing its existing
 * entry, preserving creation order.
 * @param sessions - Current session list.
 * @param session - Incoming snapshot (creation result or lifecycle broadcast).
 * @returns The updated list.
 */
export function upsertTerminalSession(
	sessions: readonly TerminalSessionSnapshot[],
	session: TerminalSessionSnapshot,
): TerminalSessionSnapshot[] {
	const index = sessions.findIndex((candidate) => candidate.id === session.id);

	if (index === -1) {
		return [...sessions, session];
	}

	return [...sessions.slice(0, index), session, ...sessions.slice(index + 1)];
}
