import { ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/renderer/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { cn } from '@/renderer/lib/utils';
import type { WorkspaceOpenTarget } from '@/renderer/types/workbench';

import { OpenTargetIcon } from './open-target-icon';

/** Props for the shared "Open in…" split button. */
interface OpenTargetSplitButtonProps {
	/** Filtered, installed targets rendered in the dropdown. */
	openTargets: WorkspaceOpenTarget[];
	/** The target the primary button invokes. */
	primaryTarget: WorkspaceOpenTarget;
	/** Runs the chosen target. */
	onInvoke: (target: WorkspaceOpenTarget) => void;
	/** Accessible label for the primary (left) button. */
	primaryAriaLabel: string;
	/** Accessible label for the chevron (dropdown) trigger. */
	menuAriaLabel: string;
	/** Optional text shown beside the primary icon; omit for an icon-only button. */
	primaryLabel?: string;
	/** Controlled open state; omit to let the button manage its own. */
	open?: boolean;
	/** Controlled open-state setter, paired with `open`. */
	onOpenChange?: (open: boolean) => void;
	/** Extra classes merged onto the outer bordered container. */
	className?: string;
}

/**
 * Bordered split button + dropdown that opens a path in one of the detected
 * apps. Shared by the workbench header (icon-only, keyboard-driven) and the
 * settings toolbar (labelled "Edit in…"). Open state is controlled when `open`
 * is supplied, otherwise self-managed.
 */
export function OpenTargetSplitButton({
	className,
	menuAriaLabel,
	onInvoke,
	onOpenChange,
	open,
	openTargets,
	primaryAriaLabel,
	primaryLabel,
	primaryTarget,
}: OpenTargetSplitButtonProps) {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
	const isControlled = onOpenChange !== undefined;
	const isOpen = isControlled ? (open ?? false) : uncontrolledOpen;
	const setOpen = isControlled ? onOpenChange : setUncontrolledOpen;

	return (
		<div
			className={cn(
				'flex h-7 shrink-0 overflow-hidden rounded-md border border-border bg-background',
				className,
			)}
		>
			<Button
				aria-label={primaryAriaLabel}
				className={cn(
					'rounded-none border-0 bg-transparent',
					primaryLabel ? 'gap-1.5' : undefined,
				)}
				onClick={() => onInvoke(primaryTarget)}
				size={primaryLabel ? 'sm' : 'icon-sm'}
				type='button'
				variant='subtle'
			>
				<OpenTargetIcon className='size-4' target={primaryTarget} />
				{primaryLabel ? (
					<span className='text-foreground'>{primaryLabel}</span>
				) : null}
			</Button>
			<div className='my-1 w-px bg-border' />
			<DropdownMenu onOpenChange={setOpen} open={isOpen}>
				<DropdownMenuTrigger asChild>
					<Button
						aria-label={menuAriaLabel}
						className='size-7 rounded-none border-0 bg-transparent'
						size='icon-sm'
						type='button'
						variant='subtle'
					>
						<ChevronDownIcon aria-hidden='true' className='size-3.5' />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='w-64 p-1'>
					{openTargets.map((target) => (
						<DropdownMenuItem
							className='h-8 gap-2.5 px-2 text-[0.8125rem]'
							key={target.id}
							onSelect={(event) => {
								event.preventDefault();
								setOpen(false);
								onInvoke(target);
							}}
						>
							<OpenTargetIcon className='size-4' target={target} />
							<span className='min-w-0 flex-1 truncate'>{target.label}</span>
							{target.shortcutLabel ? (
								<span className='shrink-0 text-muted-foreground text-xs'>
									{target.shortcutLabel}
								</span>
							) : null}
							<span className='w-3.5 shrink-0 text-right text-muted-foreground text-xs tabular-nums'>
								{target.numberShortcutLabel}
							</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
