import type { ComponentProps } from 'react';

import { ContextMenuItem } from '@/renderer/components/ui/context-menu';
import { cn } from '@/renderer/lib/utils';

/**
 * Styled wrapper around `ContextMenuItem` used by every sidebar context menu
 * (workspaces, projects, pinned workspaces). Locks down the h-8 + gap-2 + px-2
 * + text-[0.8125rem] base used across the navigation sidebar.
 */
export function SidebarContextMenuItem({
	className,
	...props
}: ComponentProps<typeof ContextMenuItem>) {
	return (
		<ContextMenuItem
			className={cn('h-8 gap-2 px-2 text-[0.8125rem]', className)}
			{...props}
		/>
	);
}
