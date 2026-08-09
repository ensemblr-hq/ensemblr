import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/renderer/components/ui/badge';
import type { SettingsResolutionSource } from '@/shared/ipc/contracts/settings-resolution';

/**
 * Names the store a resolved value came from. `.ensemblr/settings.toml` and
 * `git worktree include` are the literal file and git mechanism, so they read
 * the same in every language.
 * @param t - Translation function from `useTranslation`
 * @param source - The resolver source that won
 * @returns The display label for that source
 */
function sourceLabel(t: TFunction, source: SettingsResolutionSource): string {
	switch (source) {
		case 'built-in-default':
			return t('settings:source-badge.built-in-default', 'default');
		case 'config-default':
			return t('settings:source-badge.config-default', 'config defaults');
		case 'managed-config':
			return t('settings:source-badge.managed-config', 'managed config');
		case 'ensemblr-config':
			return '.ensemblr/settings.toml';
		case 'sqlite':
			return t('settings:source-badge.sqlite', 'personal (sqlite)');
		case 'user-default':
			return t('settings:source-badge.user-default', 'user defaults');
		case 'worktreeinclude':
			return 'git worktree include';
		default:
			return source;
	}
}

/** "Source won" label showing which file/store provided the resolved value. */
export function SourceBadge({
	locked,
	source,
}: {
	source: SettingsResolutionSource | null | undefined;
	locked?: boolean;
}) {
	const { t } = useTranslation();

	if (!source) {
		return (
			<Badge className='font-normal text-xxs' variant='outline'>
				{t('settings:source-badge.unset', 'not set')}
			</Badge>
		);
	}
	return (
		<Badge className='text-[0.625rem]' variant='outline'>
			{locked
				? t(
						'settings:source-badge.value-locked',
						'source: {{source}} · locked',
						{
							source: sourceLabel(t, source),
						},
					)
				: t('settings:source-badge.value', 'source: {{source}}', {
						source: sourceLabel(t, source),
					})}
		</Badge>
	);
}
