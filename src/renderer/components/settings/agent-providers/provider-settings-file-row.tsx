import { FileCodeIcon } from 'lucide-react';

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
	const { invokeTarget, openTargets, primaryTarget } =
		useProviderSettingsFileOpenTargets(descriptor.id);
	const label = 'Open in';

	return (
		<SettingRow
			control={
				openTargets && primaryTarget ? (
					<OpenTargetSplitButton
						menuAriaLabel={`${label} — choose an app`}
						onInvoke={(target) => void invokeTarget(target)}
						openTargets={openTargets}
						primaryAriaLabel={`${label} ${primaryTarget.label}`}
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
			description={`${descriptor.label} reads its own configuration from this file. Ensemblr never edits it — open it in your editor to change permissions, hooks, or MCP servers.`}
			label={`${descriptor.label} settings file`}
			stack
		>
			<code className='mt-2 block truncate rounded-md bg-muted/40 px-3 py-2 font-mono text-xs'>
				{settingsFile}
			</code>
		</SettingRow>
	);
}
