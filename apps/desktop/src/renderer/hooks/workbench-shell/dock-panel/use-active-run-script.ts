import { useAtomValue } from 'jotai';

import { selectActiveRunScript } from '@/renderer/lib/terminal';
import { lastRunScriptAtomFamily } from '@/renderer/state/preferences';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';
import type { RunScriptDefinition } from '@/shared/scripts';

/**
 * Resolves the run script ⌘R and the Run menu target for a workspace: the one
 * the user last ran where the repository still declares it, else the
 * repository's own default.
 *
 * Read from two places on purpose — the workspace shell registers the commands
 * so they survive the dock unmounting behind a closed rail, while the dock's own
 * header labels the button with the same script. The selector is pure, so both
 * callers agree without threading the value down through the layout.
 * @param workspace - Workspace whose run scripts are being resolved.
 * @returns The targeted script, or null when the repository declares none.
 */
export function useActiveRunScript(
	workspace: WorkspaceShellModel,
): RunScriptDefinition | null {
	const rememberedRunScript = useAtomValue(
		lastRunScriptAtomFamily(workspace.id),
	);

	return selectActiveRunScript({
		rememberedName: rememberedRunScript,
		runScripts: workspace.runScripts,
		runSummary: workspace.scripts.run,
	});
}
