import { CheckIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/renderer/components/ui/button';
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/renderer/components/ui/command';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/renderer/components/ui/popover';
import { cn } from '@/renderer/lib/utils';
import type { FacetCollapse } from '@/renderer/types/components';

/** Shape of a {@link FacetPopover}. */
interface FacetPopoverProps {
	children: ReactNode;
	/** Collapse classes from a host that narrows; without them the label always shows. */
	collapse?: FacetCollapse;
	/** How many options the facet holds selected, which its label already states. */
	count: number;
	icon: ReactNode;
	label: string;
	searchPlaceholder: string;
}

/**
 * A ghost trigger opening one multi-select facet's searchable option list. The
 * trigger names itself through `aria-label` and `title`, so it stays readable
 * when a host collapses it to its icon.
 */
export function FacetPopover({
	children,
	collapse,
	count,
	icon,
	label,
	searchPlaceholder,
}: FacetPopoverProps) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger asChild>
				<Button
					aria-label={label}
					className='h-7 shrink-0 gap-1.5 px-2 font-medium text-xs'
					size='sm'
					title={label}
					variant='ghost'
				>
					{icon}
					<span className={cn('max-w-32 truncate', collapse?.hideLabel)}>
						{label}
					</span>
					{collapse && count > 0 ? (
						<span className={collapse.showCount}>{count}</span>
					) : null}
				</Button>
			</PopoverTrigger>
			<PopoverContent align='end' className='w-56 overflow-hidden p-0'>
				<Command>
					<CommandInput placeholder={searchPlaceholder} />
					<CommandList>
						<CommandEmpty className='py-6 text-muted-foreground text-xs'>
							{t('workbench:dashboard.toolbar.facet-empty', 'Nothing to show.')}
						</CommandEmpty>
						<CommandGroup>{children}</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

/** One toggleable row inside a facet popover, check-marked while selected. */
export function FacetItem({
	children,
	isSelected,
	label,
	onSelect,
	value,
}: {
	children?: ReactNode;
	isSelected: boolean;
	label: string;
	onSelect: () => void;
	value: string;
}) {
	return (
		<CommandItem
			className='gap-2'
			keywords={[label]}
			onSelect={onSelect}
			value={value}
		>
			<span className='flex w-4 shrink-0 items-center justify-center'>
				<CheckIcon
					aria-hidden='true'
					className={cn('size-4', !isSelected && 'invisible')}
				/>
			</span>
			{children}
			<span className='min-w-0 flex-1 truncate text-[0.8125rem]'>{label}</span>
		</CommandItem>
	);
}
