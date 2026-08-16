import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { upsertTerminalSession } from '@/renderer/lib/terminal';
import type {
	CreateTerminalSessionResult,
	TerminalSessionSnapshot,
} from '@/shared/ipc/contracts/terminal';

import { activeTerminalIdsAtom } from './terminal-activity';

/** Live terminal sessions for one workspace plus create/close actions. */
interface WorkspaceTerminalSessionsState {
	/**
	 * Interactive terminal ids with recent output activity, tracked app-wide by
	 * `useWatchTerminalActivity` so the set survives navigating between
	 * workspaces. Ids are unique, so the caller's own tabs read it directly.
	 */
	activeTerminalIds: ReadonlySet<string>;
	/** Kills the session and removes its tab from the dock. */
	closeTerminal: (terminalId: string) => Promise<void>;
	/** Opens a dock terminal; without a command it spawns an interactive login shell. */
	createTerminal: (options?: {
		command?: string;
		title?: string;
	}) => Promise<CreateTerminalSessionResult>;
	sessions: TerminalSessionSnapshot[];
}

/**
 * Relaunches the interactive dock terminals that were open when the app last
 * quit, seeding each with its persisted prior output. Called only for a fresh
 * dock (no live sessions); the main process offers each workspace's set once, so
 * a later remount finds nothing to restore. Best-effort — a missing bridge or a
 * failed relaunch simply skips that tab.
 * @param workspaceId - Workspace whose dock to restore.
 * @param isCancelled - Reports whether the owning effect has since torn down.
 * @param setSessions - Folds each relaunched session into dock state.
 */
async function restoreDockTerminals(
	workspaceId: string,
	isCancelled: () => boolean,
	setSessions: (
		updater: (previous: TerminalSessionSnapshot[]) => TerminalSessionSnapshot[],
	) => void,
): Promise<void> {
	const result = await window.ensemblr
		?.listRestorableTerminals({ workspaceId })
		.catch(() => null);

	if (!result || isCancelled()) {
		return;
	}

	for (const terminal of result.terminals) {
		// Relaunch serially: each spawn assembles a workspace environment that
		// allocates a port, so concurrent creates would race on allocation, and the
		// between-spawn cancel check halts a torn-down effect mid-restore.
		// react-doctor-disable-next-line -- Serial relaunch is intentional; see above.
		const created = await window.ensemblr
			?.createTerminalSession({
				restoredFromId: terminal.id,
				seedOutput: terminal.output,
				title: terminal.title,
				workspaceId,
			})
			.catch(() => null);

		if (isCancelled()) {
			return;
		}

		const session = created?.session;
		if (session) {
			setSessions((previous) => upsertTerminalSession(previous, session));
		}
	}
}

/**
 * Tracks the live terminal sessions of a workspace: seeds from the main
 * process list, then folds lifecycle broadcasts into local state.
 * @param workspaceId - Workspace whose sessions to track.
 * @returns Session list plus create/kill actions.
 */
export function useWorkspaceTerminalSessions(
	workspaceId: string,
): WorkspaceTerminalSessionsState {
	const [sessions, setSessions] = useState<TerminalSessionSnapshot[]>([]);
	const activeTerminalIds = useAtomValue(activeTerminalIdsAtom);
	// Tabs the user explicitly closed: their later lifecycle broadcasts (exit
	// after kill) must not resurrect the tab.
	const closedTerminalIdsRef = useRef<Set<string>>(
		null as unknown as Set<string>,
	);
	if (closedTerminalIdsRef.current === null) {
		closedTerminalIdsRef.current = new Set();
	}

	// Reset session state when the workspace changes; an inline-during-render
	// comparison avoids an extra render that an effect-based reset would force.
	const [prevWorkspaceId, setPrevWorkspaceId] = useState(workspaceId);
	if (prevWorkspaceId !== workspaceId) {
		setPrevWorkspaceId(workspaceId);
		setSessions([]);
		closedTerminalIdsRef.current.clear();
	}

	useEffect(() => {
		let cancelled = false;

		window.ensemblr
			?.listTerminalSessions({ workspaceId })
			.then((result) => {
				if (cancelled) {
					return;
				}
				setSessions(result.sessions);
				// Restore only when no interactive terminal is already live. Agent
				// tabs and run/setup scripts also surface here, and a same-mount agent
				// resume can create one before this list resolves; gating on the raw
				// length would then wrongly skip the dock restore.
				const hasLiveDockTerminal = result.sessions.some(
					(session) => session.kind === 'terminal',
				);
				if (!hasLiveDockTerminal) {
					void restoreDockTerminals(workspaceId, () => cancelled, setSessions);
				}
			})
			.catch(() => {
				// Listing is best-effort; lifecycle broadcasts still hydrate state.
			});

		const unsubscribeLifecycle = window.ensemblr?.onTerminalLifecycle(
			(event) => {
				if (
					event.workspaceId !== workspaceId ||
					closedTerminalIdsRef.current.has(event.terminalId)
				) {
					return;
				}

				setSessions((previous) =>
					upsertTerminalSession(previous, event.session),
				);
			},
		);

		return () => {
			cancelled = true;
			unsubscribeLifecycle?.();
		};
	}, [workspaceId]);

	const createTerminal = useCallback(
		async (options?: {
			command?: string;
			title?: string;
		}): Promise<CreateTerminalSessionResult> => {
			const result = (await window.ensemblr?.createTerminalSession({
				...options,
				workspaceId,
			})) ?? {
				diagnostics: [
					{
						code: 'bridge-unavailable',
						// i18next-instrument-ignore -- English fallback behind the code
						message: 'The Electron preload bridge is unavailable.',
						severity: 'error' as const,
					},
				],
				session: null,
			};
			const session = result.session;

			if (session) {
				setSessions((previous) => upsertTerminalSession(previous, session));
			}

			return result;
		},
		[workspaceId],
	);

	const closeTerminal = useCallback(async (terminalId: string) => {
		closedTerminalIdsRef.current.add(terminalId);
		setSessions((previous) =>
			previous.filter((session) => session.id !== terminalId),
		);

		try {
			await window.ensemblr?.killTerminalSession({ terminalId });
		} catch {
			// The tab is gone either way; main-process cleanup is best-effort.
		}
	}, []);

	return { activeTerminalIds, closeTerminal, createTerminal, sessions };
}
