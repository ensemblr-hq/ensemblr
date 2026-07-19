import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';

import { activateWorkspaceDesktopApp } from '@/renderer/api/ensemblr/workspace-runtime';
import {
	runWorkspaceScript,
	stopWorkspaceScript,
} from '@/renderer/api/ensemblr/workspace-scripts';
import type { WorkbenchRouteSearch } from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';
import type {
	CreateTerminalSessionResult,
	TerminalSessionSnapshot,
} from '@/shared/ipc/contracts/terminal';

/** Inputs for {@link useWorkspaceDockActions}. */
interface UseWorkspaceDockActionsOptions {
	activeDockTab: string;
	/**
	 * Opens a fresh chat seeded with the settings.toml setup prompt. Built by the
	 * route content (it owns chat-tab creation) and surfaced as
	 * {@link WorkbenchDockActions.onAskAgentSetupScript}.
	 */
	askAgentSetupScript: () => void;
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
	askAgentSetupScript,
	closeTerminal,
	createTerminal,
	repositoryId,
	sessions,
	updateSearch,
	workspaceId,
}: UseWorkspaceDockActionsOptions): WorkbenchDockActions {
	const navigate = useNavigate();
	const askAgentSetupScriptRef = useRef(askAgentSetupScript);
	const updateSearchRef = useRef(updateSearch);
	const sessionsRef = useRef(sessions);
	const activeDockTabRef = useRef(activeDockTab);
	useEffect(() => {
		askAgentSetupScriptRef.current = askAgentSetupScript;
		updateSearchRef.current = updateSearch;
		sessionsRef.current = sessions;
		activeDockTabRef.current = activeDockTab;
	});

	return useMemo<WorkbenchDockActions>(
		() => ({
			onAskAgentSetupScript: () => askAgentSetupScriptRef.current(),
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
			onLaunchDesktopApp: () => {
				void activateWorkspaceDesktopApp(workspaceId)
					.then((result) => {
						if (!result.ok) {
							toast.error(result.error);
						}
					})
					.catch(() => {
						toast.error('The desktop app could not be focused.');
					});
			},
			onOpenRunPort: (url) => {
				void window.ensemblr?.openExternal(url);
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
