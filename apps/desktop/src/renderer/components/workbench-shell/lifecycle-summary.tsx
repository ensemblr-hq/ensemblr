import { Fragment } from 'react';

import { cn } from '@/renderer/lib/utils';
import type { LifecycleSummaryRow } from '@/renderer/types/workbench-shell';

/**
 * Identity card shared by the archive and delete dialogs so every confirmation
 * names its exact target. Values wrap instead of stretching the dialog, which
 * keeps long absolute paths readable in full.
 */
export function LifecycleSummary({ rows }: { rows: LifecycleSummaryRow[] }) {
	return (
		<dl className='grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs'>
			{rows.map((row) => (
				<Fragment key={row.label}>
					<dt className='text-muted-foreground'>{row.label}</dt>
					<dd
						className={cn(
							'wrap-anywhere',
							row.mono && 'font-mono text-[0.6875rem] leading-normal',
						)}
					>
						{row.value}
					</dd>
				</Fragment>
			))}
		</dl>
	);
}
