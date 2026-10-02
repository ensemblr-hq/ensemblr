import type { ComponentProps, ReactNode } from 'react';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/renderer/components/ui/tooltip';
import { cn } from '@/renderer/lib/utils';

/**
 * Hover-revealed control cluster pinned to a block's top-right corner — the
 * copy button on a code panel and the copy/expand pair on an answer table are
 * the same affordance, so they share one shell.
 *
 * The block owns the reveal: give the positioned ancestor `group/block` and the
 * cluster fades in while the block is hovered, or whenever a control inside it
 * takes keyboard focus.
 */
export function BlockControls({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				'absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 rounded-md border border-border bg-background/85 p-0.5 opacity-0 backdrop-blur-sm transition-opacity focus-within:opacity-100 group-hover/block:opacity-100',
				className,
			)}
		>
			{children}
		</div>
	);
}

/**
 * Icon-only button labelled by a tooltip rather than visible text. Used for the
 * controls inside a {@link BlockControls} cluster and for the icon actions in
 * turn footers, so every small action in the conversation reads the same.
 */
export function BlockControlButton({
	className,
	label,
	...props
}: ComponentProps<'button'> & {
	/** Names the action, for the tooltip and the accessible label. */
	label: string;
}) {
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						{...props}
						aria-label={label}
						className={cn(
							'rounded-sm p-1 text-muted-foreground opacity-70 transition hover:bg-foreground/10 hover:text-foreground hover:opacity-100 focus-visible:opacity-100',
							className,
						)}
						type='button'
					/>
				</TooltipTrigger>
				<TooltipContent>{label}</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
