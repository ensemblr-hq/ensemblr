import { useEffect, useRef } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

/** Props for a single composer autocomplete row. */
interface AutocompleteRowProps {
	active: boolean;
	icon?: React.ReactNode;
	/** Claims the highlight when the pointer genuinely moves over this row. */
	onHover: () => void;
	onSelect: () => void;
	primary: React.ReactNode;
	secondary?: React.ReactNode;
}

/** Renders one selectable row in the composer autocomplete popover. */
export function AutocompleteRow({
	active,
	icon,
	onHover,
	onSelect,
	primary,
	secondary,
}: AutocompleteRowProps) {
	const ref = useRef<HTMLButtonElement | null>(null);
	useEffect(() => {
		if (active && ref.current) {
			ref.current.scrollIntoView({ block: 'nearest' });
		}
	}, [active]);
	// Arrow keys scroll the list under a resting pointer, and that alone fires
	// mouseenter — which would snap the highlight straight back to the row the
	// cursor happens to sit over. mousemove only fires on real pointer motion.
	const claimHighlight = (): void => {
		if (!active) {
			onHover();
		}
	};
	return (
		<Button
			className={cn(
				'h-9 w-full justify-start rounded-md px-2 text-left font-normal',
				active && 'bg-muted text-foreground',
			)}
			onClick={onSelect}
			onMouseMove={claimHighlight}
			ref={ref}
			size='sm'
			type='button'
			variant='ghost'
		>
			{icon ? (
				<span className='flex size-4 shrink-0 items-center justify-center text-muted-foreground'>
					{icon}
				</span>
			) : null}
			<span className='w-72 min-w-0 truncate font-medium text-foreground'>
				{primary}
			</span>
			{secondary ? (
				<span className='min-w-0 flex-1 basis-auto truncate text-left text-muted-foreground text-xs'>
					{secondary}
				</span>
			) : null}
		</Button>
	);
}
