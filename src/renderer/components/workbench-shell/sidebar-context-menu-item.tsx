import type { ComponentProps } from 'react';

import { ContextMenuItem } from '@/renderer/components/ui/context-menu';
import { cn } from '@/renderer/lib/utils';

/**
 * Styled wrapper around `ContextMenuItem` used by every sidebar context menu
 * (workspaces, projects, pinned workspaces) and by the dashboard board's issue
 * cards. Locks down the min-h-8 + gap-2 + px-2 + text-[0.8125rem] base used
 * across the navigation sidebar; the height is a floor rather than a fixed box
 * so a label that still wraps in a longer locale grows its row instead of
 * overlapping the next one.
 */
export function SidebarContextMenuItem({
	className,
	...props
}: ComponentProps<typeof ContextMenuItem>) {
	return (
		<ContextMenuItem
			className={cn('min-h-8 gap-2 px-2 text-[0.8125rem]', className)}
			{...props}
		/>
	);
}
