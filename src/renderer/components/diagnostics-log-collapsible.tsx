import { ChevronRightIcon } from 'lucide-react';

import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@/renderer/components/ui/collapsible';
import type { SetupCheckLogSnapshot } from '@/shared/ipc/contracts/setup';

/**
 * A readiness check can attach far more command output than a settings row can
 * carry; four entries is enough to show what ran and how it failed without the
 * row becoming the page.
 */
const VISIBLE_LOG_COUNT = 4;

/**
 * Collapsed command output for one readiness or setup check, shared by the
 * setup-diagnostics panel and the Providers page so both disclose failures the
 * same way.
 */
export function DiagnosticsLogCollapsible({
	className,
	logs,
}: {
	className?: string;
	logs: readonly SetupCheckLogSnapshot[];
}) {
	if (logs.length === 0) {
		return null;
	}

	return (
		<Collapsible className={className}>
			<CollapsibleTrigger className='group inline-flex items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground'>
				<ChevronRightIcon
					aria-hidden='true'
					className='size-3.5 transition-transform group-data-[state=open]:rotate-90'
				/>
				Diagnostics log
			</CollapsibleTrigger>
			<CollapsibleContent className='mt-1.5 flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs'>
				{logs.slice(0, VISIBLE_LOG_COUNT).map((log) => (
					<p
						className='wrap-break-word text-muted-foreground leading-5'
						key={`${log.label}-${log.text}`}
					>
						<span className='font-medium text-foreground'>{log.label}</span>
						{': '}
						{log.text}
						{log.truncated ? ' (truncated)' : null}
					</p>
				))}
			</CollapsibleContent>
		</Collapsible>
	);
}
