import { FileCodeIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { Button } from '@/renderer/components/ui/button';
import { OpenTargetSplitButton } from '@/renderer/components/workbench-shell/open-target-split-button';
import { useProviderSettingsFileOpenTargets } from '@/renderer/hooks/use-provider-settings-file-open-targets';
import type { AgentProviderDescriptor } from '@/shared/agent-provider';

/**
 * Row for a provider's own configuration file, with the shared "Open in…" split
 * button. Rendered only for providers that own such a file; the descriptor
 * carries the `~`-relative path and main resolves it.
 */
export function ProviderSettingsFileRow({
	descriptor,
	settingsFile,
}: {
	descriptor: AgentProviderDescriptor;
	settingsFile: string;
}) {
	const { t } = useTranslation();
	const { invokeTarget, openTargets, primaryTarget } =
		useProviderSettingsFileOpenTargets(descriptor.id);
	const label = t('settings:providers.settings-file.open', 'Open in');

	return (
		<SettingRow
			control={
				openTargets && primaryTarget ? (
					<OpenTargetSplitButton
						menuAriaLabel={t(
							'settings:providers.settings-file.menu-aria-label',
							'{{label}} — choose an app',
							{ label },
						)}
						onInvoke={(target) => void invokeTarget(target)}
						openTargets={openTargets}
						primaryAriaLabel={t(
							'settings:providers.settings-file.primary-aria-label',
							'{{label}} {{app}}',
							{ app: primaryTarget.label, label },
						)}
						primaryLabel={label}
						primaryTarget={primaryTarget}
					/>
				) : (
					<Button disabled size='sm' variant='ghost'>
						<FileCodeIcon aria-hidden='true' className='size-4' />
						<span>{label}</span>
					</Button>
				)
			}
			description={t(
				'settings:providers.settings-file.description',
				'{{provider}} reads its own configuration from this file. Ensemblr never edits it — open it in your editor to change permissions, hooks, or MCP servers.',
				{ provider: descriptor.label },
			)}
			label={t(
				'settings:providers.settings-file.label',
				'{{provider}} settings file',
				{ provider: descriptor.label },
			)}
			stack
		>
			<code className='mt-2 block truncate rounded-md bg-muted/40 px-3 py-2 font-mono text-xs'>
				{settingsFile}
			</code>
		</SettingRow>
	);
}
