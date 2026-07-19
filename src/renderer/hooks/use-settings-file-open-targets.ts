import { useCallback } from 'react';
import { toast } from 'sonner';

import {
	getEnsemblrApiOrNull,
	openSettingsFileInTarget,
} from '@/renderer/api/ensemblr';
import { useOpenTargetMenu } from '@/renderer/hooks/workbench-shell/use-open-target-menu';
import type {
	OpenTargetsState,
	WorkspaceOpenTarget,
} from '@/renderer/types/workbench';
import type { SettingsConfigFile } from '@/shared/ipc/contracts/open-target';

/**
 * Namespaced last-used key for a settings file, kept distinct from workspace
 * ids so the two menus never share a remembered pick.
 * @param config - Which settings file the menu targets.
 * @returns The history key for that file.
 */
function settingsHistoryKey(config: SettingsConfigFile): string {
	return config.scope === 'user'
		? 'settings:user'
		: `settings:repo:${config.repositoryPath}`;
}

/**
 * Settings flavour of the open-in menu: reuses {@link useOpenTargetMenu} for the
 * detected-app list and last-used memory, then opens `config.json` /
 * `.ensemblr/settings.toml` in the chosen app via the settings IPC channel.
 */
export function useSettingsFileOpenTargets(
	config: SettingsConfigFile,
): OpenTargetsState {
	const { openTargets, primaryTarget, rememberTarget } = useOpenTargetMenu(
		settingsHistoryKey(config),
	);

	const scope = config.scope;
	const repositoryPath = config.scope === 'repo' ? config.repositoryPath : null;

	const invokeTarget = useCallback(
		async (target: WorkspaceOpenTarget) => {
			if (getEnsemblrApiOrNull() === null) {
				toast.error('Open in… is unavailable without the Electron bridge.');
				return;
			}
			const requestConfig: SettingsConfigFile =
				scope === 'user'
					? { scope: 'user' }
					: { repositoryPath: repositoryPath ?? '', scope: 'repo' };
			const result = await openSettingsFileInTarget({
				config: requestConfig,
				targetId: target.id,
			});
			if (!result.ok) {
				toast.error(`Failed to open in ${target.label}: ${result.error}`);
				return;
			}
			if (target.behavior === 'copy-path') {
				toast.success('Path copied to clipboard.');
				return;
			}
			rememberTarget(target.id);
		},
		[rememberTarget, repositoryPath, scope],
	);

	return { invokeTarget, openTargets, primaryTarget };
}
