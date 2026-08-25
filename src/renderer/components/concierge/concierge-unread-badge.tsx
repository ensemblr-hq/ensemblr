import { cn } from '@/renderer/lib/utils';

/** Above this the badge reads `9+` rather than growing past its own circle. */
const MAX_SHOWN = 9;

/**
 * Count of what the Concierge produced while its panel was shut, sitting on the
 * launcher bubble's shoulder.
 *
 * Marked `aria-hidden` on purpose: the launcher's own `aria-label` already
 * carries the count as a sentence, and a screen reader announcing the bare digit
 * as well would read the number twice.
 */
export function ConciergeUnreadBadge({ count }: { count: number }) {
	if (count <= 0) {
		return null;
	}

	return (
		<span
			aria-hidden='true'
			className={cn(
				'pointer-events-none absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-semibold text-[0.625rem] text-primary-foreground tabular-nums leading-none ring-2 ring-background',
				'motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:animate-in',
			)}
			data-concierge-unread-count={count}
		>
			{count > MAX_SHOWN ? `${MAX_SHOWN}+` : count}
		</span>
	);
}
