import { TriangleAlertIcon } from 'lucide-react';

/**
 * Centered status message shared by the conversation panels (file preview, turn
 * diff, file diff) for their empty, loading, and failure states. Prefixes a
 * warning icon in the `error` tone.
 *
 * Carries a height floor so a panel whose whole body is this message still reads
 * as a panel rather than as a collapsed line of text.
 */
export function PanelMessage({
	message,
	tone = 'muted',
}: {
	message: string;
	tone?: 'error' | 'muted';
}) {
	return (
		<div className='flex min-h-24 flex-1 items-center justify-center p-6'>
			<div className='flex items-center gap-2 text-sm'>
				{tone === 'error' ? (
					<TriangleAlertIcon
						aria-hidden='true'
						className='size-4 shrink-0 text-destructive'
					/>
				) : null}
				<span
					className={
						tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
					}
				>
					{message}
				</span>
			</div>
		</div>
	);
}
