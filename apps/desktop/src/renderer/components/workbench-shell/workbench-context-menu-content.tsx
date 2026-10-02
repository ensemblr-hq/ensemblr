import type { ComponentProps } from 'react';

import {
	ContextMenuContent,
	ContextMenuSubContent,
} from '@/renderer/components/ui/context-menu';
import { cn } from '@/renderer/lib/utils';

/**
 * The panel metrics every workbench context menu shares: `w-max` so the menu is
 * sized by its longest label rather than by a width guessed against English,
 * and `max-w-80` so a label that outgrows even that wraps inside the panel
 * instead of pushing it across the window. Rows pair this with a `min-h-*`
 * floor, so a wrapped label grows its row rather than overlapping the next one.
 *
 * Each menu still passes its own `min-w-*` — the resting width is a per-menu
 * judgement, while the cap and the growth behaviour are not.
 */
const CONTEXT_MENU_PANEL = 'w-max max-w-80 bg-muted p-1';

/**
 * Context menu panel for the workbench surfaces (sidebar, dashboard board,
 * file trees, terminal). Owns the shared panel metrics so the menus cannot
 * drift apart a width step at a time.
 */
export function WorkbenchContextMenuContent({
	className,
	...props
}: ComponentProps<typeof ContextMenuContent>) {
	return (
		<ContextMenuContent
			className={cn(CONTEXT_MENU_PANEL, className)}
			{...props}
		/>
	);
}

/**
 * Submenu panel counterpart to `WorkbenchContextMenuContent`, so a nested menu
 * grows on the same terms as the menu that opened it.
 */
export function WorkbenchContextMenuSubContent({
	className,
	...props
}: ComponentProps<typeof ContextMenuSubContent>) {
	return (
		<ContextMenuSubContent
			className={cn(CONTEXT_MENU_PANEL, className)}
			{...props}
		/>
	);
}
