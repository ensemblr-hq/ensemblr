import { Badge } from '@/renderer/components/ui/badge';
import type { SettingsResolutionSource } from '@/shared/ipc/contracts/settings-resolution';

const SOURCE_LABEL: Record<SettingsResolutionSource, string> = {
	'built-in-default': 'default',
	'config-default': 'config defaults',
	'managed-config': 'managed config',
	'ensemblr-config': '.ensemblr/settings.toml',
	sqlite: 'personal (sqlite)',
	'user-default': 'user defaults',
	worktreeinclude: 'git worktree include',
};

/** "Source won" label showing which file/store provided the resolved value. */
export function SourceBadge({
	locked,
	source,
}: {
	source: SettingsResolutionSource | null | undefined;
	locked?: boolean;
}) {
	if (!source) {
		return (
			<Badge className='text-[0.625rem]' variant='outline'>
				not set
			</Badge>
		);
	}
	return (
		<Badge className='text-[0.625rem]' variant='outline'>
			source: {SOURCE_LABEL[source] ?? source}
			{locked ? ' · locked' : ''}
		</Badge>
	);
}
