import { useCallback } from 'react';

import { useHotkey } from '@/renderer/hooks/use-hotkey';
import type { WorkspaceScriptSummary } from '@/renderer/types/workbench';

/**
 * Registers the ⌘/Ctrl+R (`run.start`) hotkey to toggle the active workspace's
 * run script: stop it while running, start it otherwise, and no-op when no run
 * script is configured (`missing`).
 *
 * The underlying {@link useHotkey} keeps its default `allowInTypeable: true` on
 * purpose — ⌘R must be captured, and its native browser reload suppressed, even
 * while a text field or the terminal's hidden textarea holds focus. This mirrors
 * the accelerator-less Reload menu item (see `application-menu.ts`); dropping the
 * capture would let ⌘R fall through to an Electron reload mid-edit.
 * @param runStatus - Current run-script status from the workspace model.
 * @param actions - Start/stop callbacks for the run script.
 */
export function useRunScriptHotkey(
	runStatus: WorkspaceScriptSummary['status'],
	actions: { onRunScript: () => void; onStopRunScript: () => void },
): void {
	const { onRunScript, onStopRunScript } = actions;

	const handleRunHotkey = useCallback(() => {
		if (runStatus === 'missing') {
			return;
		}
		if (runStatus === 'running') {
			onStopRunScript();
			return;
		}
		onRunScript();
	}, [onRunScript, onStopRunScript, runStatus]);

	useHotkey('run.start', handleRunHotkey);
}
