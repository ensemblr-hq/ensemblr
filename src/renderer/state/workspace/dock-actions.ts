import { useNavigate } from '@tanstack/react-router';
import { useMemo, useRef } from 'react';
import { toast } from 'sonner';

import {
	runWorkspaceScript,
	stopWorkspaceScript,
} from '@/renderer/api/ensemble/workspace-scripts';
import type { WorkbenchRouteSearch } from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';
import type {
	CreateTerminalSessionResult,
	TerminalSessionSnapshot,
} from '@/shared/ipc/contracts/terminal';

/** Inputs for {@link useWorkspaceDockActions}. */
export interface UseWorkspaceDockActionsOptions {
	activeDockTab: string;
	closeTerminal: (terminalId: string) => Promise<void>;
	createTerminal: () => Promise<CreateTerminalSessionResult>;
	/** Repository id (`$repoId`) used to open its Scripts settings page. */
	repositoryId: string;
	sessions: readonly TerminalSessionSnapshot[];
	updateSearch: (nextSearch: WorkbenchRouteSearch) => void;
	workspaceId: string;
}

/**
 * Wires the dock action callbacks: terminal create/close (with focus-follow
 * and last-tab protection) and script run/stop (with conflict toasts).
 *
 * The returned object is stable per workspace. Per-render inputs
 * (`updateSearch`, `sessions`, `activeDockTab`) are routed through refs so the
 * memoized handlers always read the fresh values without re-creating the
 * actions object — dock components receive it as a prop and would re-render
 * otherwise.
 * @param options - Live workspace terminal state plus route-search updater.
 * @returns The {@link WorkbenchDockActions} for the dock panel.
 */
export function useWorkspaceDockActions({
	activeDockTab,
	closeTerminal,
	createTerminal,
	repositoryId,
	sessions,
	updateSearch,
	workspaceId,
}: UseWorkspaceDockActionsOptions): WorkbenchDockActions {
	const navigate = useNavigate();
	const updateSearchRef = useRef(updateSearch);
	updateSearchRef.current = updateSearch;
	const sessionsRef = useRef(sessions);
	sessionsRef.current = sessions;
	const activeDockTabRef = useRef(activeDockTab);
	activeDockTabRef.current = activeDockTab;

	return useMemo<WorkbenchDockActions>(
		() => ({
			onCloseTerminal: (terminalId) => {
				const remaining = sessionsRef.current.filter(
					(session) => session.kind === 'terminal' && session.id !== terminalId,
				);

				void closeTerminal(terminalId);

				// Terminals close down to zero; when the active tab is the one being
				// closed, fall back to the next terminal or the fixed Setup tab.
				if (activeDockTabRef.current === `terminal:${terminalId}`) {
					const nextTerminal = remaining.at(-1);
					updateSearchRef.current({
						dock: nextTerminal ? `terminal:${nextTerminal.id}` : 'setup',
					});
				}
			},
			onNewTerminal: () => {
				void createTerminal()
					.then((result) => {
						if (result.session) {
							updateSearchRef.current({
								dock: `terminal:${result.session.id}`,
							});
							return;
						}

						const error = result.diagnostics.find(
							(diagnostic) => diagnostic.severity === 'error',
						);
						toast.error(error?.message ?? 'The terminal could not start.');
					})
					.catch(() => {
						toast.error('The terminal could not start.');
					});
			},
			onOpenRunPort: (url) => {
				void window.ensemble?.openExternal(url);
			},
			onOpenSetupScripts: () => {
				void navigate({
					params: { repoId: repositoryId },
					to: '/settings/repo/$repoId/scripts',
				});
			},
			onRunScript: () => {
				void runWorkspaceScript({ kind: 'run', workspaceId })
					.then((result) => notifyScriptConflict(result.diagnostics))
					.catch(() => undefined);
				updateSearchRef.current({ dock: 'run' });
			},
			onRunSetupScript: () => {
				void runWorkspaceScript({ kind: 'setup', workspaceId })
					.then((result) => notifyScriptConflict(result.diagnostics))
					.catch(() => undefined);
				updateSearchRef.current({ dock: 'setup' });
			},
			onStopRunScript: () => {
				void stopWorkspaceScript({ kind: 'run', workspaceId }).catch(
					() => undefined,
				);
			},
			onStopSetupScript: () => {
				void stopWorkspaceScript({ kind: 'setup', workspaceId }).catch(
					() => undefined,
				);
			},
		}),
		[closeTerminal, createTerminal, navigate, repositoryId, workspaceId],
	);
}

/** Surfaces script diagnostics (e.g. duplicate-run conflicts) to the user. */
function notifyScriptConflict(
	diagnostics: readonly { code: string; message: string }[],
): void {
	const conflict = diagnostics.find(
		(diagnostic) =>
			diagnostic.code === 'script-already-running' ||
			diagnostic.code === 'script-not-configured',
	);

	if (conflict) {
		toast.warning(conflict.message);
	}
}
