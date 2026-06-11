import { DEFAULT_TERMINAL_DOCK_TAB_ID } from '@/renderer/lib/workbench/constants';
import type {
	DockTabStatus,
	TerminalDockTabModel,
} from '@/renderer/types/workbench';
import type {
	TerminalSessionSnapshot,
	TerminalSessionStatus,
} from '@/shared/ipc';

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
 * excluded here. When no interactive session exists yet, a placeholder default
 * tab keeps the terminal surface visible.
 * @param sessions - Live terminal sessions for the workspace.
 * @returns The terminal dock tabs.
 */
export function mapTerminalSessionsToDockTabs(
	sessions: readonly TerminalSessionSnapshot[],
): TerminalDockTabModel[] {
	const interactiveSessions = sessions.filter(
		(session) => session.kind === 'terminal',
	);

	if (interactiveSessions.length === 0) {
		return [
			{
				id: DEFAULT_TERMINAL_DOCK_TAB_ID,
				isDefault: true,
				kind: 'terminal',
				label: 'Terminal',
				sessionStatus: null,
				status: 'idle',
				terminalId: null,
			},
		];
	}

	return interactiveSessions.map((session) => ({
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
