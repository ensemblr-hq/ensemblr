import { atom } from 'jotai';
import type {
	TerminalSessionKind,
	TerminalSessionSnapshot,
	TerminalSessionStatus,
} from '@/shared/ipc/contracts/terminal';

/** Transient dock activity state used by workspace sidebar badges. */
export type WorkspaceDockActivityState = 'running' | 'setup-running';

/** The slice of a terminal session the activity badges reason about. */
export interface TerminalActivitySnapshot {
	kind: TerminalSessionKind;
	status: TerminalSessionStatus;
	workspaceId: string;
}

/**
 * Live terminal sessions across every workspace, keyed by terminal id and
 * trimmed to what the badges need. Filled by `useWatchTerminalActivity` from the
 * main process's cross-workspace listing plus lifecycle broadcasts, so a
 * workspace whose route is not mounted still reports its running terminals.
 * Sessions that stop running are dropped rather than kept as dead entries.
 */
export const terminalActivitySnapshotsAtom = atom<
	Record<string, TerminalActivitySnapshot>
>({});

/**
 * Interactive dock terminals with recent output from a command the user
 * submitted. An open shell sitting at its prompt is not activity, so this set —
 * not the session's `running` status — is what lights an interactive terminal.
 */
export const activeTerminalIdsAtom = atom<ReadonlySet<string>>(
	new Set<string>(),
);

/**
 * Dock activity per workspace for the navigation sidebar, derived from the live
 * session map rather than from any one workspace's mounted dock. Both inputs are
 * app-wide, so an inactive row keeps its dot for as long as its terminal runs.
 */
export const workspaceDockActivityByWorkspaceAtom = atom((get) =>
	computeWorkspaceDockActivity(
		get(terminalActivitySnapshotsAtom),
		get(activeTerminalIdsAtom),
	),
);

/**
 * Classifies one running session for the badge, or reports that it does not
 * count as dock activity. Agent and archive sessions are represented elsewhere
 * in the row (the state icon), so they stay out of this dot.
 * @param kind - Session kind being classified.
 * @param hasRecentOutput - Whether an interactive terminal is mid-command.
 * @returns The badge state, or null when the session does not light the dot.
 */
function dockActivityStateForSession(
	kind: TerminalSessionKind,
	hasRecentOutput: boolean,
): WorkspaceDockActivityState | null {
	if (kind === 'setup-script') {
		return 'setup-running';
	}
	if (kind === 'run-script') {
		return 'running';
	}
	if (kind === 'terminal') {
		return hasRecentOutput ? 'running' : null;
	}
	return null;
}

/**
 * Folds the live session map into one badge state per workspace, with a running
 * setup script outranking any other activity in the same workspace.
 * @param snapshots - Live sessions keyed by terminal id.
 * @param activeTerminalIds - Interactive terminals with recent command output.
 * @returns Badge state keyed by workspace id; workspaces with no activity are absent.
 */
export function computeWorkspaceDockActivity(
	snapshots: Record<string, TerminalActivitySnapshot>,
	activeTerminalIds: ReadonlySet<string>,
): Record<string, WorkspaceDockActivityState> {
	const activity: Record<string, WorkspaceDockActivityState> = {};

	for (const [terminalId, snapshot] of Object.entries(snapshots)) {
		if (snapshot.status !== 'running') {
			continue;
		}
		const state = dockActivityStateForSession(
			snapshot.kind,
			activeTerminalIds.has(terminalId),
		);
		if (!state) {
			continue;
		}
		if (state === 'setup-running' || !activity[snapshot.workspaceId]) {
			activity[snapshot.workspaceId] = state;
		}
	}

	return activity;
}

/**
 * Reduces a session snapshot into the activity map, dropping it once the session
 * is no longer running so the map only ever holds live work.
 * @param snapshots - Current activity map.
 * @param session - Incoming session snapshot from a listing or lifecycle broadcast.
 * @returns The updated map, or the same reference when nothing changed.
 */
export function reduceTerminalActivitySnapshot(
	snapshots: Record<string, TerminalActivitySnapshot>,
	session: TerminalSessionSnapshot,
): Record<string, TerminalActivitySnapshot> {
	const current = snapshots[session.id];

	if (session.status !== 'running') {
		if (!current) {
			return snapshots;
		}
		const { [session.id]: _removed, ...rest } = snapshots;
		return rest;
	}

	if (
		current?.kind === session.kind &&
		current.status === session.status &&
		current.workspaceId === session.workspaceId
	) {
		return snapshots;
	}

	return {
		...snapshots,
		[session.id]: {
			kind: session.kind,
			status: session.status,
			workspaceId: session.workspaceId,
		},
	};
}
