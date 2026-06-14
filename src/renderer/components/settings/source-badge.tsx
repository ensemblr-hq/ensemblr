import { Badge } from '@/renderer/components/ui/badge';
import type { SettingsResolutionSource } from '@/shared/ipc';

const SOURCE_LABEL: Record<SettingsResolutionSource, string> = {
	'built-in-default': 'default',
	'conductor-config': 'conductor.json',
	'conductor-legacy-config': 'conductor.local.json',
	'conductor-local-config': 'conductor.local.json',
	'config-default': 'config defaults',
	'managed-config': 'managed config',
	'ensemble-config': 'ensemble.json',
	sqlite: 'personal (sqlite)',
	worktreeinclude: 'git worktree include',
};

interface SourceBadgeProps {
	source: SettingsResolutionSource | null | undefined;
	locked?: boolean;
}

/** "Source won" label showing which file/store provided the resolved value. */
export function SourceBadge({ locked, source }: SourceBadgeProps) {
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
