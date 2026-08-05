import { useState } from 'react';

import { RunScriptIcon } from '@/renderer/components/run-script-icon';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/renderer/components/ui/popover';
import { cn } from '@/renderer/lib/utils';
import {
	formatRunScriptLabel,
	RUN_SCRIPT_ICON_NAMES,
	type RunScriptIconName,
} from '@/shared/scripts';

/**
 * Picks a run script's icon from the curated lucide set. The grid is filtered
 * by a plain substring search rather than a Command list because the options
 * are icons, not labelled rows.
 */
export function RunScriptIconPicker({
	onChange,
	value,
}: {
	onChange: (icon: RunScriptIconName) => void;
	value: RunScriptIconName;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const normalizedQuery = query.trim().toLowerCase();
	const matches = normalizedQuery
		? RUN_SCRIPT_ICON_NAMES.filter((name) => name.includes(normalizedQuery))
		: RUN_SCRIPT_ICON_NAMES;

	return (
		<Popover
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setQuery('');
				}
			}}
			open={open}
		>
			<PopoverTrigger asChild>
				<Button
					aria-label={`Icon: ${formatRunScriptLabel(value)}`}
					size='icon'
					type='button'
					variant='outline'
				>
					<RunScriptIcon name={value} />
				</Button>
			</PopoverTrigger>
			<PopoverContent align='start' className='w-64 p-2'>
				<Input
					aria-label='Search icons'
					className='h-8 text-xs'
					onChange={(event) => setQuery(event.target.value)}
					placeholder='Search icons'
					value={query}
				/>
				<div className='mt-2 grid max-h-56 grid-cols-8 gap-1 overflow-y-auto'>
					{matches.map((name) => (
						<button
							aria-label={formatRunScriptLabel(name)}
							aria-pressed={name === value}
							className={cn(
								'grid size-7 place-items-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground',
								name === value && 'bg-muted text-foreground',
							)}
							key={name}
							onClick={() => {
								onChange(name);
								setOpen(false);
							}}
							type='button'
						>
							<RunScriptIcon className='size-4' name={name} />
						</button>
					))}
				</div>
				{matches.length === 0 ? (
					<p className='py-3 text-center text-muted-foreground text-xs'>
						No icons match “{query}”.
					</p>
				) : null}
			</PopoverContent>
		</Popover>
	);
}
