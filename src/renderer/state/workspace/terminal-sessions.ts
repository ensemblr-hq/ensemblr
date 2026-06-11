import { useCallback, useEffect, useRef, useState } from 'react';

import { upsertTerminalSession } from '@/renderer/lib/terminal/terminal-tabs';
import type {
	CreateTerminalSessionResult,
	TerminalSessionSnapshot,
} from '@/shared/ipc';

/** Live terminal sessions for one workspace plus create/close actions. */
export interface WorkspaceTerminalSessionsState {
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
	const closedTerminalIdsRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		let cancelled = false;
		setSessions([]);
		closedTerminalIdsRef.current = new Set();

		window.ensemble
			?.listTerminalSessions({ workspaceId })
			.then((result) => {
				if (!cancelled) {
					setSessions(result.sessions);
				}
			})
			.catch(() => {
				// Listing is best-effort; lifecycle broadcasts still hydrate state.
			});

		const unsubscribe = window.ensemble?.onTerminalLifecycle((event) => {
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
			const result = (await window.ensemble?.createTerminalSession({
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
			await window.ensemble?.killTerminalSession({ terminalId });
		} catch {
			// The tab is gone either way; main-process cleanup is best-effort.
		}
	}, []);

	return { closeTerminal, createTerminal, sessions };
}
