import { ChevronDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	Command,
	CommandEmpty,
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

/** One selectable row of a quick-property menu. */
export interface IssuePropertyOption {
	icon?: ReactNode;
	id: string;
	label: string;
}

/**
 * Above this many options the menu grows a search field. A five-row priority
 * list is faster to read than to type into; a workspace's user list is not.
 */
const SEARCHABLE_FROM = 8;

/** Props for {@link IssuePropertyPicker}. */
interface IssuePropertyPickerProps {
	ariaLabel: string;
	disabled?: boolean;
	emptyText: string;
	onSelect: (id: string) => void;
	options: IssuePropertyOption[];
	/** Shown in the trigger when nothing is set yet. */
	placeholder: string;
	/** Holds the glyph column open while nothing is set, so the rail stays in one line. */
	placeholderIcon?: ReactNode;
	searchPlaceholder: string;
	selectedId: string | null;
}

/**
 * One property of an issue, changed in place. The trigger reads as the value
 * itself rather than as a form control, so the rail scans as a summary until it
 * is hovered — which is what makes a status change one click from the page
 * instead of a trip through the editor dialog.
 */
export function IssuePropertyPicker({
	ariaLabel,
	disabled,
	emptyText,
	onSelect,
	options,
	placeholder,
	placeholderIcon,
	searchPlaceholder,
	selectedId,
}: IssuePropertyPickerProps) {
	const [open, setOpen] = useState(false);
	const selected = options.find((option) => option.id === selectedId) ?? null;

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger asChild>
				<Button
					aria-label={ariaLabel}
					className={cn(
						'flex h-6 w-full justify-start gap-1.5 px-1.5 font-normal text-[0.8125rem]',
						selected ? null : 'text-muted-foreground',
					)}
					disabled={disabled}
					size='xs'
					variant='ghost'
				>
					{selected ? selected.icon : placeholderIcon}
					<span className='min-w-0 flex-1 truncate text-left'>
						{selected ? selected.label : placeholder}
					</span>
					<ChevronDownIcon
						aria-hidden='true'
						className='size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/property:opacity-100'
					/>
				</Button>
			</PopoverTrigger>
			<PopoverContent align='start' className='w-56 p-0' sideOffset={2}>
				<Command>
					{options.length >= SEARCHABLE_FROM ? (
						<CommandInput placeholder={searchPlaceholder} />
					) : null}
					<CommandList className='max-h-64'>
						<CommandEmpty className='py-4 text-[0.8125rem] text-muted-foreground'>
							{emptyText}
						</CommandEmpty>
						{options.map((option) => (
							<CommandItem
								className='gap-1.5 py-1 text-[0.8125rem]'
								data-checked={option.id === selectedId ? 'true' : undefined}
								key={option.id}
								keywords={[option.label]}
								onSelect={() => {
									setOpen(false);
									if (option.id !== selectedId) {
										onSelect(option.id);
									}
								}}
								value={option.id}
							>
								{option.icon}
								<span className='min-w-0 flex-1 truncate'>{option.label}</span>
							</CommandItem>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

/**
 * A property whose value the page shows but does not edit — project, cycle, due
 * date. It carries the picker trigger's box model, transparent border included,
 * so its glyph sits on the same pixel column as the editable rows above rather
 * than one inside them.
 */
export function IssuePropertyValue({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<span
			className={cn(
				'flex min-h-6 min-w-0 items-center gap-1.5 border border-transparent px-1.5 text-[0.8125rem] text-foreground',
				className,
			)}
		>
			{children}
		</span>
	);
}

/**
 * One labelled row of the property rail. It borrows the rail's two columns
 * through `grid-cols-subgrid`, so every label shares one track sized to the
 * longest of them — the gutter stays tight in English without clipping the
 * longer Russian and Greek words a fixed width would have wrapped.
 */
export function IssuePropertyRow({
	children,
	label,
}: {
	children: ReactNode;
	label: string;
}) {
	return (
		<div className='group/property col-span-2 grid min-w-0 grid-cols-subgrid items-center'>
			<span className='whitespace-nowrap text-muted-foreground text-xxs'>
				{label}
			</span>
			<div className='min-w-0'>{children}</div>
		</div>
	);
}
