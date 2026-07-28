import { TriangleAlertIcon } from 'lucide-react';

/**
 * Inline failure banner for a panel whose remaining content still works, such as
 * a GitHub sync error above an otherwise usable checks list. The headline stays
 * human-readable and `detail` carries the raw message underneath.
 */
export function PanelAlert({
	detail,
	title,
}: {
	/** Verbatim underlying error text, demoted below the headline. */
	detail?: string;
	title: string;
}) {
	return (
		<div
			className='flex min-w-0 items-start gap-2.5 rounded-md border border-status-danger/30 bg-status-danger/10 px-3 py-2.5'
			role='alert'
		>
			<TriangleAlertIcon
				aria-hidden='true'
				className='mt-0.5 size-3.5 shrink-0 text-status-danger'
			/>
			<div className='flex min-w-0 flex-col gap-0.5'>
				<p className='font-medium text-status-danger text-xs leading-5'>
					{title}
				</p>
				{detail ? (
					<p className='min-w-0 break-words font-mono text-muted-foreground text-xs leading-5'>
						{detail}
					</p>
				) : null}
			</div>
		</div>
	);
}
