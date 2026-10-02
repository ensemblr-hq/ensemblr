import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/renderer/lib/utils';

/**
 * Read-only monospace value block used wherever settings surface a resolved
 * path, file, or command. Carries the optional "source:" caption so a resolved
 * value and the store it came from always render at the same size and rhythm.
 */
export function SettingsCodeValue({
	className,
	source,
	value,
}: {
	value: ReactNode;
	/** Store the value resolved from, rendered as a caption beneath the block. */
	source?: string | null;
	className?: string;
}) {
	const { t } = useTranslation();

	return (
		<div className={cn('space-y-1', className)}>
			<code className='block truncate rounded-lg bg-muted/40 px-3 py-2 font-mono text-foreground text-xs'>
				{value}
			</code>
			{source ? (
				<p className='text-muted-foreground text-xxs'>
					{t('settings:common.source', 'source: {{source}}', { source })}
				</p>
			) : null}
		</div>
	);
}
