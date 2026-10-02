import type { ComponentProps, ReactNode } from 'react';

import { Button } from '@/renderer/components/ui/button';

/**
 * Ghost `icon-sm` button carrying a screen-reader-only label. Every remaining
 * prop — `ref` included, which React 19 passes like any other — is forwarded, so
 * it can back a Radix `asChild` trigger (tooltip, dropdown).
 *
 * Its own module so the tab strip and the controls that sit beside it share one
 * definition rather than each declaring a look-alike.
 */
export function GhostIconButton({
	icon,
	label,
	...props
}: { icon: ReactNode; label: string } & ComponentProps<typeof Button>) {
	return (
		<Button size='icon-sm' variant='ghost' {...props}>
			{icon}
			<span className='sr-only'>{label}</span>
		</Button>
	);
}
