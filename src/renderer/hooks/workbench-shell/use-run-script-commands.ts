import { useActiveRunScript } from '@/renderer/hooks/workbench-shell/dock-panel/use-active-run-script';
import { useDockMenuCommands } from '@/renderer/hooks/workbench-shell/use-dock-menu-commands';
import { useRunScriptHotkey } from '@/renderer/hooks/workbench-shell/use-run-script-hotkey';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { WorkbenchDockActions } from '@/renderer/types/workbench-shell';

/**
 * Registers every command that starts or stops a workspace's scripts: ⌘R, the
 * Workspace menu's Run Script submenu, Run Setup, and New Terminal — resolving
 * the script ⌘R targets from the repository's run scripts and the user's last
 * choice.
 *
 * Registered by the shell rather than by the dock that shows the output, for the
 * same reason as {@link useReviewPanelCommands}: below the review rail's
 * breakpoint the dock is hosted by a sheet that unmounts when dismissed, and ⌘R
 * is owned by its menu item on macOS, so a registration that died with the view
 * would leave AppKit swallowing the chord against a disabled item.
 * @param workspace - Workspace whose scripts the commands act on
 * @param actions - The dock's action bundle
 */
export function useRunScriptCommands(
	workspace: WorkspaceShellModel,
	actions: WorkbenchDockActions,
): void {
	const activeRunScript = useActiveRunScript(workspace);

	useRunScriptHotkey(workspace.scripts.run.status, actions, activeRunScript);
	useDockMenuCommands(
		workspace.scripts.run.status,
		actions,
		activeRunScript,
		workspace.runScripts,
	);
}
