import { Button } from '@/renderer/components/ui/button';

export function ChecksEmptyMessage({ label }: { label: string }) {
	return <p className='text-muted-foreground text-xs'>{label}</p>;
}

/** Section header used inside the checks panel (label + optional action). */
export function ChecksSectionHeader({
	actionLabel,
	label,
	onAction,
}: {
	actionLabel?: string;
	label: string;
	onAction?: () => void;
}) {
	return (
		<div className='flex min-h-6 min-w-0 items-center justify-between gap-2'>
			<h3 className='font-semibold text-muted-foreground text-xs'>{label}</h3>
			{actionLabel ? (
				<Button
					className='h-6 px-1.5 text-xs'
					onClick={onAction}
					size='xs'
					variant='subtle'
				>
					{actionLabel}
				</Button>
			) : null}
		</div>
	);
}
