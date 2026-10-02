import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
	getEnsemblrApiOrNull,
	openAgentProviderSettingsFile,
} from '@/renderer/api/ensemblr';
import { useOpenTargetMenu } from '@/renderer/hooks/workbench-shell/use-open-target-menu';
import type {
	OpenTargetsState,
	WorkspaceOpenTarget,
} from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';

/**
 * Provider flavour of the open-in menu: reuses {@link useOpenTargetMenu} for the
 * detected-app list and last-used memory, then opens the provider's own settings
 * file (`~/.claude/settings.json`) in the chosen app. Main resolves the
 * `~`-relative path against the home directory; the renderer never does.
 * @param provider - Which agent provider's settings file the menu targets.
 * @returns The open-target menu state with a provider-aware `invokeTarget`.
 */
export function useProviderSettingsFileOpenTargets(
	provider: AgentProviderId,
): OpenTargetsState {
	const {
		copyTarget,
		openInTargets,
		openTargets,
		primaryTarget,
		rememberTarget,
	} = useOpenTargetMenu(`agent-provider:${provider}`);
	const { t } = useTranslation();

	const invokeTarget = useCallback(
		async (target: WorkspaceOpenTarget) => {
			if (getEnsemblrApiOrNull() === null) {
				toast.error(
					t(
						'errors:open-target.bridge-unavailable.title',
						'Open in… is unavailable without the Electron bridge.',
					),
				);
				return;
			}
			const result = await openAgentProviderSettingsFile(provider, target.id);
			if (!result.opened) {
				toast.error(
					result.error ??
						t(
							'errors:open-target.settings-open-failed.title',
							'Failed to open the settings file in {{target}}.',
							{ target: target.label },
						),
				);
				return;
			}
			if (target.behavior === 'copy-path') {
				toast.success(
					t('common:clipboard.path-copied', 'Path copied to clipboard.'),
				);
				return;
			}
			rememberTarget(target.id);
		},
		[provider, rememberTarget, t],
	);

	return {
		copyTarget,
		invokeTarget,
		openInTargets,
		openTargets,
		primaryTarget,
	};
}
