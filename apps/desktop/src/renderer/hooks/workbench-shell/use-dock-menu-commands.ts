import { useCallback, useMemo } from 'react';

import {
	useMenuCommand,
	useMenuCommandChecked,
	useMenuDynamicEntries,
} from '@/renderer/state/menu-commands';
import type { WorkspaceScriptSummary } from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';
import type { MenuDynamicEntry } from '@/shared/menu-commands';
import type { RunScriptDefinition } from '@/shared/scripts';

/**
 * Registers the Workspace menu's script and terminal commands, and fills the
 * Run Script submenu with the repository's configured scripts.
 *
 * `run.toggle` mirrors the ⌘R behaviour exactly rather than reimplementing it:
 * stop while running, otherwise start the active script.
 * @param runStatus - Current run-script status from the workspace model
 * @param actions - The dock's action bundle
 * @param activeRunScript - Script ⌘R targets, or null when the repository configures none
 * @param runScripts - Every run script the repository declares
 */
export function useDockMenuCommands(
	runStatus: WorkspaceScriptSummary['status'],
	actions: WorkbenchDockActions,
	activeRunScript: RunScriptDefinition | null,
	runScripts: readonly RunScriptDefinition[],
): void {
	const { onNewTerminal, onRunScript, onRunSetupScript, onStopRunScript } =
		actions;
	const activeScriptName = activeRunScript?.name ?? null;
	const isRunning = runStatus === 'running';

	const toggleRun = useCallback(() => {
		if (isRunning) {
			onStopRunScript();
			return;
		}
		if (activeScriptName) {
			onRunScript(activeScriptName);
		}
	}, [activeScriptName, isRunning, onRunScript, onStopRunScript]);

	const runNamedScript = useCallback(
		(scriptName?: string) => {
			if (scriptName) {
				onRunScript(scriptName);
			}
		},
		[onRunScript],
	);

	const scriptEntries = useMemo<readonly MenuDynamicEntry[]>(
		() => runScripts.map((script) => ({ id: script.name, label: script.name })),
		[runScripts],
	);

	useMenuCommand(
		'run.toggle',
		toggleRun,
		isRunning || Boolean(activeScriptName),
	);
	useMenuCommandChecked('run.toggle', isRunning);
	useMenuCommand('run.script', runNamedScript, runScripts.length > 0);
	useMenuDynamicEntries('runScripts', scriptEntries);
	useMenuCommand('run.setup', onRunSetupScript);
	useMenuCommand('terminal.new', onNewTerminal);
}
