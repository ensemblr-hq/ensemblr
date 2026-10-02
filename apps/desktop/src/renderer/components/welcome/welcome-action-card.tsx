import type { LucideIcon } from 'lucide-react';

import { cn } from '@/renderer/lib/utils';

/** Props for a welcome-screen action tile. */
interface WelcomeActionCardProps {
	className?: string;
	disabled?: boolean;
	icon: LucideIcon;
	label: string;
	onClick?: () => void;
}

/**
 * Action tile rendered under the welcome wordmark. Fills the grid cell it is
 * placed in rather than carrying a width of its own, so a row of them shrinks
 * with the pane instead of wrapping; `min-h` rather than `h` so a label that
 * wraps to a third line in a longer locale grows the tile instead of
 * overflowing it.
 *
 * The label drops a type tier once the row's container falls below 28rem — the
 * narrowest tier above the ~403px at which a label's longest unbreakable token
 * stops fitting its cell on a wide fallback font. The grid track is
 * `minmax(0, 1fr)`, so such a token would paint outside the tile rather than
 * wrap it. Only a host that declares `@container/welcome-actions` shrinks
 * anything; anywhere else the named query never matches and the label stays at
 * `text-sm`.
 */
export function WelcomeActionCard({
	className,
	disabled,
	icon: Icon,
	label,
	onClick,
}: WelcomeActionCardProps) {
	return (
		<button
			className={cn(
				'group/welcome-action flex min-h-32 w-full flex-col items-start justify-between gap-3 rounded-xl bg-card p-3 text-left ring-1 ring-foreground/10 transition-colors hover:bg-pane-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-card',
				className,
			)}
			disabled={disabled}
			onClick={onClick}
			type='button'
		>
			<Icon
				aria-hidden='true'
				className='size-5 text-muted-foreground transition-colors group-hover/welcome-action:text-foreground'
			/>
			<span className='text-balance font-medium @max-md/welcome-actions:text-xs text-foreground text-sm'>
				{label}
			</span>
		</button>
	);
}
