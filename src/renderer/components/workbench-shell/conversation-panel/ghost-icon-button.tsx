import {
	type ComponentPropsWithoutRef,
	forwardRef,
	type ReactNode,
} from 'react';

import { Button } from '@/renderer/components/ui/button';

/**
 * Ghost `icon-sm` button carrying a screen-reader-only label. Forwards its ref
 * and props so it can back a Radix `asChild` trigger (tooltip, dropdown).
 *
 * Its own module so the tab strip and the controls that sit beside it share one
 * definition rather than each declaring a look-alike.
 */
export const GhostIconButton = forwardRef<
	HTMLButtonElement,
	{ icon: ReactNode; label: string } & ComponentPropsWithoutRef<typeof Button>
>(({ icon, label, ...props }, ref) => (
	<Button ref={ref} size='icon-sm' variant='ghost' {...props}>
		{icon}
		<span className='sr-only'>{label}</span>
	</Button>
));
GhostIconButton.displayName = 'GhostIconButton';
