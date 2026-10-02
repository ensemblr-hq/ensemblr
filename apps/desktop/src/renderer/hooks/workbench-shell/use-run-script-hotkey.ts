import { useCallback } from 'react';

import { useHotkey } from '@/renderer/hooks/use-hotkey';
import type { WorkspaceScriptSummary } from '@/renderer/types/workbench';
import type { RunScriptDefinition } from '@/shared/scripts';

/**
 * Registers the ⌘/Ctrl+R (`run.start`) hotkey to toggle the active workspace's
 * run script: stop it while running, start the active script otherwise, and
 * no-op when the repository configures none.
 *
 * The underlying {@link useHotkey} keeps its default `allowInTypeable: true` on
 * purpose — ⌘R must be captured, and its native browser reload suppressed, even
 * while a text field or the terminal's hidden textarea holds focus. This mirrors
 * the accelerator-less Reload menu item (see `application-menu.ts`); dropping the
 * capture would let ⌘R fall through to an Electron reload mid-edit.
 * @param runStatus - Current run-script status from the workspace model.
 * @param actions - Start/stop callbacks for the run script.
 * @param activeRunScript - Script the hotkey starts, or null when none apply.
 */
export function useRunScriptHotkey(
	runStatus: WorkspaceScriptSummary['status'],
	actions: {
		onRunScript: (scriptName?: string) => void;
		onStopRunScript: () => void;
	},
	activeRunScript: RunScriptDefinition | null,
): void {
	const { onRunScript, onStopRunScript } = actions;
	const activeScriptName = activeRunScript?.name ?? null;

	const handleRunHotkey = useCallback(() => {
		if (runStatus === 'running') {
			onStopRunScript();
			return;
		}
		if (!activeScriptName) {
			return;
		}
		onRunScript(activeScriptName);
	}, [activeScriptName, onRunScript, onStopRunScript, runStatus]);

	useHotkey('run.start', handleRunHotkey);
}
