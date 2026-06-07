import { ShieldAlertIcon } from 'lucide-react';

/** Inline notice explaining local-execution guarantees beneath the checks list. */
export function LocalExecutionNotice() {
	return (
		<section
			className='rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2.5'
			data-local-execution-notice='true'
		>
			<div className='flex items-start gap-2'>
				<ShieldAlertIcon
					aria-hidden='true'
					className='mt-0.5 size-4 shrink-0 text-status-warning'
				/>
				<div className='min-w-0'>
					<h2 className='font-medium text-xs'>Local execution</h2>
					<p className='mt-1 text-muted-foreground text-xs leading-5'>
						Agents, scripts, terminals, and tools run locally with your macOS
						account permissions. Workspace trusted mode is the default; stricter
						modes can require approval or read-only access where supported.
					</p>
				</div>
			</div>
		</section>
	);
}
