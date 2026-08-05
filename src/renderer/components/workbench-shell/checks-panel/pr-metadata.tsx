import { Button } from '@/renderer/components/ui/button';

/** Renders a muted placeholder message for an empty checks section. */
export function ChecksEmptyMessage({ label }: { label: string }) {
	return <p className='text-muted-foreground text-xs'>{label}</p>;
}

/** Section header used inside the checks panel (label + optional action). */
export function ChecksSectionHeader({
	actionLabel,
	disabled = false,
	label,
	onAction,
}: {
	actionLabel?: string;
	/**
	 * Blocks the action while an agent turn is changing the state it acts on. A
	 * missing `onAction` blocks it too, so the button is never a live no-op.
	 */
	disabled?: boolean;
	label: string;
	onAction?: () => void;
}) {
	return (
		<div className='flex min-h-6 min-w-0 items-center justify-between gap-2'>
			<h3 className='font-semibold text-muted-foreground text-xs'>{label}</h3>
			{actionLabel ? (
				<Button
					className='h-6 px-1.5 text-xs'
					disabled={disabled || !onAction}
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
