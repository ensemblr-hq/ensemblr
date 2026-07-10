import { useCallback, useEffect, useRef, useState } from 'react';

import { upsertTerminalSession } from '@/renderer/lib/terminal/terminal-tabs';
import type {
	CreateTerminalSessionResult,
	TerminalSessionSnapshot,
} from '@/shared/ipc/contracts/terminal';

/** Live terminal sessions for one workspace plus create/close actions. */
interface WorkspaceTerminalSessionsState {
	/** Kills the session and removes its tab from the dock. */
	closeTerminal: (terminalId: string) => Promise<void>;
	createTerminal: () => Promise<CreateTerminalSessionResult>;
	sessions: TerminalSessionSnapshot[];
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
		closedTerminalIdsRef.current = new Set();
	}

	useEffect(() => {
		let cancelled = false;

		window.ensemblr
			?.listTerminalSessions({ workspaceId })
			.then((result) => {
				if (!cancelled) {
					setSessions(result.sessions);
				}
			})
			.catch(() => {
				// Listing is best-effort; lifecycle broadcasts still hydrate state.
			});

		const unsubscribe = window.ensemblr?.onTerminalLifecycle((event) => {
			if (
				event.workspaceId !== workspaceId ||
				closedTerminalIdsRef.current.has(event.terminalId)
			) {
				return;
			}

			setSessions((previous) => upsertTerminalSession(previous, event.session));
		});

		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, [workspaceId]);

	const createTerminal =
		useCallback(async (): Promise<CreateTerminalSessionResult> => {
			const result = (await window.ensemblr?.createTerminalSession({
				workspaceId,
			})) ?? {
				diagnostics: [
					{
						code: 'bridge-unavailable',
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
		}, [workspaceId]);

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

	return { closeTerminal, createTerminal, sessions };
}
