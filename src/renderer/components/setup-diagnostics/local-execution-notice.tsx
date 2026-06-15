import { InfoIcon } from 'lucide-react';

/** Quiet footnote explaining local-execution guarantees beneath the checks list. */
export function LocalExecutionNotice() {
	return (
		<p
			className='flex items-start gap-2 text-muted-foreground text-xs leading-5'
			data-local-execution-notice='true'
		>
			<InfoIcon aria-hidden='true' className='mt-0.5 size-3.5 shrink-0' />
			<span>
				Agents, scripts, terminals, and tools run locally with your macOS
				account permissions. Workspace trusted mode is the default; stricter
				modes can require approval or read-only access where supported.
			</span>
		</p>
	);
}
