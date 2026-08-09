import { useNavigate } from '@tanstack/react-router';
import { useSetAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
	runWorkspaceScript,
	stopWorkspaceScript,
} from '@/renderer/api/ensemblr/workspace-scripts';
import { lastRunScriptAtomFamily } from '@/renderer/state/preferences';
import { useProvideDockTerminal } from '@/renderer/state/workspace/terminal-requests';
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
	createTerminal: (options?: {
		command?: string;
		title?: string;
	}) => Promise<CreateTerminalSessionResult>;
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
	const { t } = useTranslation();
	const setLastRunScript = useSetAtom(lastRunScriptAtomFamily(workspaceId));
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

	/**
	 * Spawns a dock terminal and focuses its tab, reporting a failed spawn as a
	 * toast. Backs both the dock's own "New terminal" action and the requests
	 * other surfaces queue when they need a real TTY.
	 * @param options - Command to run and tab title; omitted for a login shell.
	 */
	const openTerminal = useCallback(
		(options?: { command?: string; title?: string }) => {
			void createTerminal(options)
				.then((result) => {
					if (result.session) {
						updateSearchRef.current({ dock: `terminal:${result.session.id}` });
						return;
					}

					const error = result.diagnostics.find(
						(diagnostic) => diagnostic.severity === 'error',
					);
					toast.error(
						error?.message ??
							t(
								'errors:terminal.start-failed.title',
								'The terminal could not start.',
							),
					);
				})
				.catch(() => {
					toast.error(
						t(
							'errors:terminal.start-failed.title',
							'The terminal could not start.',
						),
					);
				});
		},
		[createTerminal, t],
	);
	useProvideDockTerminal(workspaceId, openTerminal);

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
			onNewTerminal: () => openTerminal(),
			onOpenRunPort: (url) => {
				void window.ensemblr?.openExternal(url);
			},
			onOpenSetupScripts: () => {
				void navigate({
					params: { repoId: repositoryId },
					to: '/settings/repo/$repoId/scripts',
				});
			},
			onRunScript: (scriptName) => {
				if (scriptName) {
					setLastRunScript(scriptName);
				}

				void runWorkspaceScript({
					kind: 'run',
					scriptName: scriptName ?? null,
					workspaceId,
				})
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
		[
			closeTerminal,
			navigate,
			openTerminal,
			repositoryId,
			setLastRunScript,
			workspaceId,
		],
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
